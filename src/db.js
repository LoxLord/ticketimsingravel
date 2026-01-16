const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function initDb(baseDir) {
  ensureDir(baseDir);
  const dbPath = path.join(baseDir, 'bot.sqlite');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      admin_role_ids TEXT NOT NULL DEFAULT '[]',
      panel_channel_id TEXT,
      panel_message_id TEXT,
      ticket_counter INTEGER NOT NULL DEFAULT 0,
      ticket_channel_naming TEXT NOT NULL DEFAULT 'number'
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT,
      parent_category_id TEXT NOT NULL,
      form_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_roles (
      category_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (category_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS tickets (
      guild_id TEXT NOT NULL,
      ticket_number INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      closed_at_ms INTEGER,
      PRIMARY KEY (guild_id, ticket_number)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_channel_id ON tickets(channel_id);

    CREATE TABLE IF NOT EXISTS ticket_extra_users (
      guild_id TEXT NOT NULL,
      ticket_number INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, ticket_number, user_id)
    );

    CREATE TABLE IF NOT EXISTS ticket_extra_roles (
      guild_id TEXT NOT NULL,
      ticket_number INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, ticket_number, role_id)
    );

    CREATE TABLE IF NOT EXISTS ticket_transcripts (
      guild_id TEXT NOT NULL,
      ticket_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (guild_id, ticket_number)
    );
  `);

  const guildColumns = db.prepare("PRAGMA table_info('guild_settings')").all().map((r) => r.name);
  if (!guildColumns.includes('ticket_channel_naming')) {
    db.exec("ALTER TABLE guild_settings ADD COLUMN ticket_channel_naming TEXT NOT NULL DEFAULT 'number'");
  }

  const statements = {
    getGuild: db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?'),
    upsertGuild: db.prepare(
      'INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING'
    ),
    setAdminRoles: db.prepare('UPDATE guild_settings SET admin_role_ids = ? WHERE guild_id = ?'),
    setPanel: db.prepare('UPDATE guild_settings SET panel_channel_id = ?, panel_message_id = ? WHERE guild_id = ?'),
    setTicketChannelNaming: db.prepare('UPDATE guild_settings SET ticket_channel_naming = ? WHERE guild_id = ?'),

    listCategories: db.prepare('SELECT * FROM categories WHERE guild_id = ? ORDER BY name ASC'),
    getCategory: db.prepare('SELECT * FROM categories WHERE guild_id = ? AND id = ?'),
    insertCategory: db.prepare(
      'INSERT INTO categories (id, guild_id, name, emoji, parent_category_id, form_text) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    updateCategory: db.prepare(
      'UPDATE categories SET name = COALESCE(?, name), emoji = COALESCE(?, emoji), parent_category_id = COALESCE(?, parent_category_id), form_text = COALESCE(?, form_text) WHERE guild_id = ? AND id = ?'
    ),
    deleteCategoryRoles: db.prepare('DELETE FROM category_roles WHERE category_id = ?'),
    insertCategoryRole: db.prepare('INSERT OR IGNORE INTO category_roles (category_id, role_id) VALUES (?, ?)'),
    listCategoryRoles: db.prepare('SELECT role_id FROM category_roles WHERE category_id = ?'),
    deleteCategory: db.prepare('DELETE FROM categories WHERE guild_id = ? AND id = ?'),

    getOpenTicketByUser: db.prepare(
      "SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open' LIMIT 1"
    ),
    listOpenTickets: db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = 'open' ORDER BY created_at_ms ASC"),
    getTicketByChannel: db.prepare('SELECT * FROM tickets WHERE channel_id = ? LIMIT 1'),
    incrementTicketCounter: db.prepare('UPDATE guild_settings SET ticket_counter = ticket_counter + 1 WHERE guild_id = ?'),
    getTicketCounter: db.prepare('SELECT ticket_counter FROM guild_settings WHERE guild_id = ?'),
    insertTicket: db.prepare(
      'INSERT INTO tickets (guild_id, ticket_number, user_id, channel_id, category_id, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    setTicketStatusClosed: db.prepare(
      "UPDATE tickets SET status = 'closed', closed_at_ms = ? WHERE guild_id = ? AND ticket_number = ?"
    ),
    setTicketStatusOpen: db.prepare(
      "UPDATE tickets SET status = 'open', closed_at_ms = NULL WHERE guild_id = ? AND ticket_number = ?"
    ),

    insertExtraUser: db.prepare('INSERT OR IGNORE INTO ticket_extra_users (guild_id, ticket_number, user_id) VALUES (?, ?, ?)'),
    deleteExtraUser: db.prepare('DELETE FROM ticket_extra_users WHERE guild_id = ? AND ticket_number = ? AND user_id = ?'),
    listExtraUsers: db.prepare('SELECT user_id FROM ticket_extra_users WHERE guild_id = ? AND ticket_number = ?'),

    insertExtraRole: db.prepare('INSERT OR IGNORE INTO ticket_extra_roles (guild_id, ticket_number, role_id) VALUES (?, ?, ?)'),
    deleteExtraRole: db.prepare('DELETE FROM ticket_extra_roles WHERE guild_id = ? AND ticket_number = ? AND role_id = ?'),
    listExtraRoles: db.prepare('SELECT role_id FROM ticket_extra_roles WHERE guild_id = ? AND ticket_number = ?'),

    upsertTranscript: db.prepare(
      'INSERT INTO ticket_transcripts (guild_id, ticket_number, content, created_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, ticket_number) DO UPDATE SET content = excluded.content, created_at_ms = excluded.created_at_ms'
    )
  };

  function ensureGuild(guildId) {
    statements.upsertGuild.run(guildId);
    return statements.getGuild.get(guildId);
  }

  function getGuildSettings(guildId) {
    return ensureGuild(guildId);
  }

  function setAdminRoleIds(guildId, roleIds) {
    ensureGuild(guildId);
    statements.setAdminRoles.run(JSON.stringify(roleIds), guildId);
    return getGuildSettings(guildId);
  }

  function resetAdminRoleIds(guildId) {
    return setAdminRoleIds(guildId, []);
  }

  function setPanelMessage(guildId, channelId, messageId) {
    ensureGuild(guildId);
    statements.setPanel.run(channelId, messageId, guildId);
    return getGuildSettings(guildId);
  }

  function setTicketChannelNaming(guildId, mode) {
    ensureGuild(guildId);
    statements.setTicketChannelNaming.run(mode, guildId);
    return getGuildSettings(guildId);
  }

  function listCategories(guildId) {
    return statements.listCategories.all(guildId);
  }

  function getCategory(guildId, categoryId) {
    return statements.getCategory.get(guildId, categoryId);
  }

  function getCategoryRoleIds(categoryId) {
    return statements.listCategoryRoles.all(categoryId).map((r) => r.role_id);
  }

  function createCategory({ id, guildId, name, emoji, parentCategoryId, formText, roleIds }) {
    statements.insertCategory.run(id, guildId, name, emoji || null, parentCategoryId, formText);
    for (const roleId of roleIds) {
      statements.insertCategoryRole.run(id, roleId);
    }
    return getCategory(guildId, id);
  }

  function updateCategory({ guildId, categoryId, name, emoji, parentCategoryId, formText }) {
    statements.updateCategory.run(name ?? null, emoji ?? null, parentCategoryId ?? null, formText ?? null, guildId, categoryId);
    return getCategory(guildId, categoryId);
  }

  function setCategoryRoles({ categoryId, roleIds }) {
    statements.deleteCategoryRoles.run(categoryId);
    for (const roleId of roleIds) {
      statements.insertCategoryRole.run(categoryId, roleId);
    }
    return getCategoryRoleIds(categoryId);
  }

  function deleteCategory(guildId, categoryId) {
    statements.deleteCategoryRoles.run(categoryId);
    statements.deleteCategory.run(guildId, categoryId);
  }

  function getOpenTicketByUser(guildId, userId) {
    return statements.getOpenTicketByUser.get(guildId, userId);
  }

  function listOpenTickets(guildId) {
    return statements.listOpenTickets.all(guildId);
  }

  function getTicketByChannel(channelId) {
    return statements.getTicketByChannel.get(channelId);
  }

  function nextTicketNumber(guildId) {
    ensureGuild(guildId);
    statements.incrementTicketCounter.run(guildId);
    return statements.getTicketCounter.get(guildId).ticket_counter;
  }

  function createTicket({ guildId, ticketNumber, userId, channelId, categoryId }) {
    statements.insertTicket.run(guildId, ticketNumber, userId, channelId, categoryId, 'open', nowMs());
  }

  function closeTicket({ guildId, ticketNumber }) {
    statements.setTicketStatusClosed.run(nowMs(), guildId, ticketNumber);
  }

  function reopenTicket({ guildId, ticketNumber }) {
    statements.setTicketStatusOpen.run(guildId, ticketNumber);
  }

  function addExtraUsers({ guildId, ticketNumber, userIds }) {
    for (const userId of userIds) {
      statements.insertExtraUser.run(guildId, ticketNumber, userId);
    }
  }

  function removeExtraUsers({ guildId, ticketNumber, userIds }) {
    for (const userId of userIds) {
      statements.deleteExtraUser.run(guildId, ticketNumber, userId);
    }
  }

  function addExtraRoles({ guildId, ticketNumber, roleIds }) {
    for (const roleId of roleIds) {
      statements.insertExtraRole.run(guildId, ticketNumber, roleId);
    }
  }

  function removeExtraRoles({ guildId, ticketNumber, roleIds }) {
    for (const roleId of roleIds) {
      statements.deleteExtraRole.run(guildId, ticketNumber, roleId);
    }
  }

  function listExtraUsers({ guildId, ticketNumber }) {
    return statements.listExtraUsers.all(guildId, ticketNumber).map((r) => r.user_id);
  }

  function listExtraRoles({ guildId, ticketNumber }) {
    return statements.listExtraRoles.all(guildId, ticketNumber).map((r) => r.role_id);
  }

  function saveTranscript({ guildId, ticketNumber, content }) {
    statements.upsertTranscript.run(guildId, ticketNumber, content, nowMs());
  }

  return {
    db,
    getGuildSettings,
    setAdminRoleIds,
    resetAdminRoleIds,
    setPanelMessage,
    setTicketChannelNaming,
    listCategories,
    getCategory,
    getCategoryRoleIds,
    createCategory,
    updateCategory,
    setCategoryRoles,
    deleteCategory,
    listOpenTickets,
    getOpenTicketByUser,
    getTicketByChannel,
    nextTicketNumber,
    createTicket,
    closeTicket,
    reopenTicket,
    addExtraUsers,
    removeExtraUsers,
    addExtraRoles,
    removeExtraRoles,
    listExtraUsers,
    listExtraRoles,
    saveTranscript
  };
}

module.exports = {
  initDb
};
