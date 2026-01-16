const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  ChannelType
} = require('discord.js');
const crypto = require('crypto');

const pendingCategoryCreate = new Map();
const pendingCategoryRoleUpdate = new Map();
const pendingCategoryEdit = new Map();

function generateId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function parseJsonArray(value) {
  try {
    const arr = JSON.parse(value);
    if (Array.isArray(arr)) return arr;
    return [];
  } catch {
    return [];
  }
}

function memberHasAnyRole(member, roleIds) {
  for (const roleId of roleIds) {
    if (member.roles.cache.has(roleId)) return true;
  }
  return false;
}

function canUseSetup({ member, guildSettings }) {
  const adminRoleIds = parseJsonArray(guildSettings.admin_role_ids);

  if (adminRoleIds.length > 0) {
    return memberHasAnyRole(member, adminRoleIds);
  }

  return member.permissions.has(PermissionFlagsBits.Administrator);
}

function buildTicketPanelComponents(categories) {
  const options = categories.map((c) => {
    const opt = {
      label: c.name,
      value: c.id
    };

    if (c.emoji) {
      opt.emoji = c.emoji;
    }

    return opt;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket:panel')
    .setPlaceholder('Bir kategori seçiniz')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);

  const embed = new EmbedBuilder().setDescription('Ticket oluşturmak için aşağıdan bir kategori seçiniz.');

  return { embeds: [embed], components: [row] };
}

function buildTicketButtonsOpen() {
  const close = new ButtonBuilder()
    .setCustomId('ticket:close')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒')
    .setLabel('Ticket Kapat');

  const add = new ButtonBuilder()
    .setCustomId('ticket:add')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('➕')
    .setLabel('Yetkili Ekle');

  const remove = new ButtonBuilder()
    .setCustomId('ticket:remove')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('➖')
    .setLabel('Yetkili Çıkar');

  return [new ActionRowBuilder().addComponents(close, add, remove)];
}

function buildTicketButtonsClosed() {
  const del = new ButtonBuilder()
    .setCustomId('ticket:delete')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🗑️')
    .setLabel('Ticket Sil');

  const reopen = new ButtonBuilder()
    .setCustomId('ticket:reopen')
    .setStyle(ButtonStyle.Success)
    .setEmoji('🔓')
    .setLabel('Ticket Yeniden Aç');

  return [new ActionRowBuilder().addComponents(del, reopen)];
}

async function tryUpdatePanelMessage({ client, db, guildId }) {
  const settings = db.getGuildSettings(guildId);
  if (!settings.panel_channel_id || !settings.panel_message_id) return;

  const categories = db.listCategories(guildId);
  const channel = await client.channels.fetch(settings.panel_channel_id).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const message = await channel.messages.fetch(settings.panel_message_id).catch(() => null);
  if (!message) return;

  if (categories.length < 1) {
    const embed = new EmbedBuilder().setDescription('Ticket sistemi aktif değildir.');
    await message.edit({ embeds: [embed], components: [] }).catch(() => null);
    return;
  }

  const panel = buildTicketPanelComponents(categories);
  await message.edit(panel).catch(() => null);
}

function buildSetupMainMenuResponse(content) {
  const embed = new EmbedBuilder().setDescription('Kurulum menüsünden bir işlem seçiniz.');

  const panel = new ButtonBuilder()
    .setCustomId('setup:panel_send')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('📩')
    .setLabel('Panel');

  const adminRoles = new ButtonBuilder()
    .setCustomId('setup:admin_roles')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🛡️')
    .setLabel('Yetkili Roller');

  const ticketChannelSettings = new ButtonBuilder()
    .setCustomId('setup:ticket_channel_settings')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🏷️')
    .setLabel('Bilet Kanal Ayarları');

  const addCategory = new ButtonBuilder()
    .setCustomId('setup:category_add')
    .setStyle(ButtonStyle.Success)
    .setEmoji('➕')
    .setLabel('Kategori Ekle');

  const editCategory = new ButtonBuilder()
    .setCustomId('setup:category_edit')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('✏️')
    .setLabel('Kategori Düzenle');

  const categoryRoles = new ButtonBuilder()
    .setCustomId('setup:category_roles')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('👥')
    .setLabel('Kategori Rolleri');

  const deleteCategory = new ButtonBuilder()
    .setCustomId('setup:category_delete')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🗑️')
    .setLabel('Kategori Sil');

  const listCategories = new ButtonBuilder()
    .setCustomId('setup:category_list')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📄')
    .setLabel('Kategori Liste');

  const closeAllTickets = new ButtonBuilder()
    .setCustomId('setup:close_all_tickets')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🧹')
    .setLabel('Tüm Ticketları Kapat');

  const row1 = new ActionRowBuilder().addComponents(panel, adminRoles, ticketChannelSettings, addCategory, editCategory);
  const row2 = new ActionRowBuilder().addComponents(categoryRoles, deleteCategory, listCategories, closeAllTickets);

  return {
    ...(content ? { content } : {}),
    embeds: [embed],
    components: [row1, row2]
  };
}

function buildSetupBackRow() {
  const back = new ButtonBuilder()
    .setCustomId('setup:back')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('↩️')
    .setLabel('Geri');

  return new ActionRowBuilder().addComponents(back);
}

function buildTicketChannelSettingsMenu({ currentMode }) {
  const modeText = currentMode === 'user' ? 'Açan Kişi Adı' : 'Ticket-<Numara>';
  const embed = new EmbedBuilder().setDescription(`Bilet kanal adı modu: **${modeText}**`);

  const byUser = new ButtonBuilder()
    .setCustomId('setup:naming_user')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('👤')
    .setLabel('Açan Kişi');

  const byNumber = new ButtonBuilder()
    .setCustomId('setup:naming_number')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔢')
    .setLabel('Ticket-Numara');

  const back = new ButtonBuilder()
    .setCustomId('setup:back')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('↩️')
    .setLabel('Geri');

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(byUser, byNumber, back)]
  };
}

function buildCategoryPickMenu({ customId, categories, placeholder }) {
  const options = categories.map((c) => ({ label: c.name, value: c.id }));
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options);
  return [new ActionRowBuilder().addComponents(select)];
}

function buildPanelChannelSelectComponents() {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('setup:panel_channel')
    .setPlaceholder('Panelin gönderileceği kanalı seçiniz')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText);
  return [new ActionRowBuilder().addComponents(select)];
}

function buildCategoryParentSelectComponents(customId) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Discord kategori kanalı seçiniz')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildCategory);
  return [new ActionRowBuilder().addComponents(select)];
}

function buildCategoryAddModal() {
  const modal = new ModalBuilder().setCustomId('setup:category_add_modal').setTitle('Kategori Ekle');

  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Kategori adı')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const emoji = new TextInputBuilder()
    .setCustomId('emoji')
    .setLabel('Emoji (opsiyonel)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const form = new TextInputBuilder()
    .setCustomId('form')
    .setLabel('Form / soru mesajı')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(emoji),
    new ActionRowBuilder().addComponents(form)
  );

  return modal;
}

function buildCategoryEditModal(category) {
  const modal = new ModalBuilder().setCustomId('setup:category_edit_modal').setTitle('Kategori Düzenle');

  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Kategori adı (boş bırakılırsa değişmez)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  if (category.name) {
    name.setPlaceholder(category.name);
  }

  const emoji = new TextInputBuilder()
    .setCustomId('emoji')
    .setLabel('Emoji (boş bırakılırsa değişmez)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  if (category.emoji) {
    emoji.setPlaceholder(category.emoji);
  }

  const form = new TextInputBuilder()
    .setCustomId('form')
    .setLabel('Form / soru mesajı (boş bırakılırsa değişmez)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  if (category.form_text) {
    form.setPlaceholder(String(category.form_text).slice(0, 100));
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(emoji),
    new ActionRowBuilder().addComponents(form)
  );

  return modal;
}

async function replyCategoryList({ interaction, db, guildId }) {
  const categories = db.listCategories(guildId);
  if (categories.length < 1) {
    await interaction.update(buildSetupMainMenuResponse('Kategori bulunamadı.'));
    return;
  }

  const lines = [];
  for (const c of categories) {
    const roleIds = db.getCategoryRoleIds(c.id);
    const rolesText = roleIds.map((r) => `<@&${r}>`).join(' ');
    lines.push(`ID: ${c.id}\nAd: ${c.name}\nEmoji: ${c.emoji || '-'}\nDiscord Kategori: ${c.parent_category_id}\nRoller: ${rolesText || '-'}\n`);
  }

  await interaction.update(buildSetupMainMenuResponse(lines.join('\n')));
}

async function handleSetupAction({ interaction, client, db, action }) {
  const guildId = interaction.guildId;
  const member = interaction.member;
  const guildSettings = db.getGuildSettings(guildId);

  if (!canUseSetup({ member, guildSettings })) {
    await interaction.reply({ content: 'Bu komutu kullanmak için yetkiniz yok.', ephemeral: true });
    return;
  }

  if (action === 'panel_send') {
    await interaction.update({
      content: 'Panelin gönderileceği kanalı seçiniz.',
      embeds: [],
      components: [...buildPanelChannelSelectComponents(), buildSetupBackRow()]
    });
    return;
  }

  if (action === 'admin_roles') {
    const menu = new RoleSelectMenuBuilder()
      .setCustomId('setup:admin_roles')
      .setPlaceholder('Kurulum için yetkili rolleri seçiniz')
      .setMinValues(1)
      .setMaxValues(25);

    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.update({ content: 'Yetkili roller seçimini yapınız.', embeds: [], components: [row, buildSetupBackRow()] });
    return;
  }

  if (action === 'ticket_channel_settings') {
    const currentMode = guildSettings.ticket_channel_naming || 'number';
    await interaction.update({ content: 'Bilet kanal ayarları', ...buildTicketChannelSettingsMenu({ currentMode }) });
    return;
  }

  if (action === 'category_add') {
    const currentCount = db.listCategories(guildId).length;
    if (currentCount >= 25) {
      await interaction.update(buildSetupMainMenuResponse('Discord select menü limiti nedeniyle en fazla 25 kategori kullanılabilir.'));
      return;
    }

    const key = `${guildId}:${interaction.user.id}`;
    pendingCategoryCreate.set(key, {});
    await interaction.update({
      content: 'Kategori için Discord kategori kanalını seçiniz.',
      embeds: [],
      components: [...buildCategoryParentSelectComponents('setup:category_add_parent'), buildSetupBackRow()]
    });
    return;
  }

  if (action === 'category_list') {
    await replyCategoryList({ interaction, db, guildId });
    return;
  }

  const categories = db.listCategories(guildId);
  if (categories.length < 1) {
    await interaction.update(buildSetupMainMenuResponse('Kategori bulunamadı.'));
    return;
  }

  if (categories.length > 25) {
    await interaction.update(buildSetupMainMenuResponse('Discord select menü limiti nedeniyle en fazla 25 kategori kullanılabilir.'));
    return;
  }

  if (action === 'category_edit') {
    await interaction.update({
      content: 'Düzenlenecek kategoriyi seçiniz.',
      embeds: [],
      components: [...buildCategoryPickMenu({ customId: 'setup:category_edit_select', categories, placeholder: 'Kategori seçiniz' }), buildSetupBackRow()]
    });
    return;
  }

  if (action === 'category_roles') {
    await interaction.update({
      content: 'Rolü güncellenecek kategoriyi seçiniz.',
      embeds: [],
      components: [...buildCategoryPickMenu({ customId: 'setup:category_roles_select', categories, placeholder: 'Kategori seçiniz' }), buildSetupBackRow()]
    });
    return;
  }

  if (action === 'category_delete') {
    await interaction.update({
      content: 'Silinecek kategoriyi seçiniz.',
      embeds: [],
      components: [...buildCategoryPickMenu({ customId: 'setup:category_delete_select', categories, placeholder: 'Kategori seçiniz' }), buildSetupBackRow()]
    });
    return;
  }

  await interaction.update(buildSetupMainMenuResponse('Bilinmeyen işlem.'));
}

async function handleSetupButton({ interaction, client, db }) {
  const id = interaction.customId;

  if (id === 'setup:back') {
    const key = `${interaction.guildId}:${interaction.user.id}`;
    pendingCategoryCreate.delete(key);
    pendingCategoryEdit.delete(key);
    pendingCategoryRoleUpdate.delete(key);
    await interaction.update(buildSetupMainMenuResponse(null));
    return;
  }

  if (id === 'setup:panel_send') {
    await handleSetupAction({ interaction, client, db, action: 'panel_send' });
    return;
  }

  if (id === 'setup:admin_roles') {
    await handleSetupAction({ interaction, client, db, action: 'admin_roles' });
    return;
  }

  if (id === 'setup:ticket_channel_settings') {
    await handleSetupAction({ interaction, client, db, action: 'ticket_channel_settings' });
    return;
  }

  if (id === 'setup:category_add') {
    await handleSetupAction({ interaction, client, db, action: 'category_add' });
    return;
  }

  if (id === 'setup:category_edit') {
    await handleSetupAction({ interaction, client, db, action: 'category_edit' });
    return;
  }

  if (id === 'setup:category_roles') {
    await handleSetupAction({ interaction, client, db, action: 'category_roles' });
    return;
  }

  if (id === 'setup:category_delete') {
    await handleSetupAction({ interaction, client, db, action: 'category_delete' });
    return;
  }

  if (id === 'setup:category_list') {
    await handleSetupAction({ interaction, client, db, action: 'category_list' });
    return;
  }

  if (id === 'setup:naming_user' || id === 'setup:naming_number') {
    const guildId = interaction.guildId;
    const member = interaction.member;
    const guildSettings = db.getGuildSettings(guildId);

    if (!canUseSetup({ member, guildSettings })) {
      await interaction.reply({ content: 'Bu komutu kullanmak için yetkiniz yok.', ephemeral: true });
      return;
    }

    const mode = id === 'setup:naming_user' ? 'user' : 'number';
    db.setTicketChannelNaming(guildId, mode);
    const updated = db.getGuildSettings(guildId);
    await interaction.update({ content: 'Bilet kanal ayarları güncellendi.', ...buildTicketChannelSettingsMenu({ currentMode: updated.ticket_channel_naming || 'number' }) });
    return;
  }

  if (id === 'setup:close_all_tickets') {
    const guildId = interaction.guildId;
    const member = interaction.member;
    const guildSettings = db.getGuildSettings(guildId);

    if (!canUseSetup({ member, guildSettings })) {
      await interaction.reply({ content: 'Bu komutu kullanmak için yetkiniz yok.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const openTickets = db.listOpenTickets(guildId);
    if (openTickets.length < 1) {
      await interaction.editReply({ content: 'Açık ticket bulunamadı.' });
      return;
    }

    let closedCount = 0;
    let missingCount = 0;

    for (const ticket of openTickets) {
      const result = await closeTicketRecord({ client, db, ticket });
      if (result.status === 'closed') closedCount += 1;
      if (result.status === 'missing_channel') missingCount += 1;
    }

    const extra = missingCount > 0 ? ` (Kanal bulunamayan: ${missingCount})` : '';
    await interaction.editReply({ content: `İşlem tamamlandı. Kapatılan ticket: ${closedCount}${extra}` });
    return;
  }

  await interaction.reply({ content: 'Bilinmeyen kurulum butonu.', ephemeral: true });
}

async function handleSetupCategoryEditSelect({ interaction, db }) {
  const guildId = interaction.guildId;
  const categoryId = interaction.values[0];
  const category = db.getCategory(guildId, categoryId);

  if (!category) {
    await interaction.update(buildSetupMainMenuResponse('Kategori bulunamadı.'));
    return;
  }

  const key = `${guildId}:${interaction.user.id}`;
  pendingCategoryEdit.set(key, { categoryId, updates: {} });

  await interaction.showModal(buildCategoryEditModal(category));
}

async function handleSetupCategoryRolesSelect({ interaction, db }) {
  const guildId = interaction.guildId;
  const categoryId = interaction.values[0];
  const existing = db.getCategory(guildId, categoryId);
  if (!existing) {
    await interaction.update(buildSetupMainMenuResponse('Kategori bulunamadı.'));
    return;
  }

  const key = `${guildId}:${interaction.user.id}`;
  pendingCategoryRoleUpdate.set(key, { categoryId });

  const menu = new RoleSelectMenuBuilder()
    .setCustomId('setup:category_roles_update')
    .setPlaceholder('Kategori yetkili rollerini seçiniz')
    .setMinValues(1)
    .setMaxValues(25);

  await interaction.update({
    content: 'Kategori için yeni yetkili rollerini seçiniz.',
    embeds: [],
    components: [new ActionRowBuilder().addComponents(menu), buildSetupBackRow()]
  });
}

async function handleSetupCategoryDeleteSelect({ interaction, client, db }) {
  const guildId = interaction.guildId;
  const categoryId = interaction.values[0];
  const existing = db.getCategory(guildId, categoryId);
  if (!existing) {
    await interaction.update(buildSetupMainMenuResponse('Kategori bulunamadı.'));
    return;
  }

  db.deleteCategory(guildId, categoryId);
  await tryUpdatePanelMessage({ client, db, guildId });

  await interaction.update(buildSetupMainMenuResponse('Kategori silindi.'));
}

async function handleSetupChannelSelect({ interaction, client, db }) {
  const guildId = interaction.guildId;

  if (interaction.customId === 'setup:panel_channel') {
    const channelId = interaction.values[0];
    const categories = db.listCategories(guildId);
    if (categories.length < 1) {
      await interaction.update(buildSetupMainMenuResponse('En az 1 kategori olmadan sistem aktif olamaz.'));
      return;
    }

    if (categories.length > 25) {
      await interaction.update(buildSetupMainMenuResponse('Discord select menü limiti nedeniyle en fazla 25 kategori kullanılabilir.'));
      return;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.update(buildSetupMainMenuResponse('Kanal bulunamadı.'));
      return;
    }

    const panel = buildTicketPanelComponents(categories);
    const message = await channel.send(panel).catch(() => null);
    if (!message) {
      await interaction.update(buildSetupMainMenuResponse('Panele mesaj gönderilemedi.'));
      return;
    }

    db.setPanelMessage(guildId, channel.id, message.id);
    await interaction.update(buildSetupMainMenuResponse('Ticket paneli gönderildi.'));
    return;
  }

  if (interaction.customId === 'setup:category_add_parent') {
    const key = `${guildId}:${interaction.user.id}`;
    const pending = pendingCategoryCreate.get(key);
    if (!pending) {
      await interaction.update(buildSetupMainMenuResponse('Bekleyen kategori işlemi bulunamadı.'));
      return;
    }

    pending.parentCategoryId = interaction.values[0];
    pendingCategoryCreate.set(key, pending);

    await interaction.showModal(buildCategoryAddModal());
    return;
  }

  if (interaction.customId === 'setup:category_edit_parent') {
    const key = `${guildId}:${interaction.user.id}`;
    const pending = pendingCategoryEdit.get(key);
    if (!pending) {
      await interaction.update(buildSetupMainMenuResponse('Bekleyen kategori düzenleme bulunamadı.'));
      return;
    }

    const parentCategoryId = interaction.values[0];
    const { categoryId, updates } = pending;

    db.updateCategory({
      guildId,
      categoryId,
      name: updates.name ?? null,
      emoji: updates.emoji ?? null,
      parentCategoryId,
      formText: updates.formText ?? null
    });

    pendingCategoryEdit.delete(key);
    await tryUpdatePanelMessage({ client, db, guildId });

    await interaction.update(buildSetupMainMenuResponse('Kategori güncellendi.'));
    return;
  }

  await interaction.update(buildSetupMainMenuResponse('Bilinmeyen kanal seçimi.'));
}

async function handleSetupModalSubmit({ interaction, db }) {
  const guildId = interaction.guildId;

  if (interaction.customId === 'setup:category_add_modal') {
    const key = `${guildId}:${interaction.user.id}`;
    const pending = pendingCategoryCreate.get(key);
    if (!pending || !pending.parentCategoryId) {
      await interaction.reply({ content: 'Bekleyen kategori işlemi bulunamadı.', ephemeral: true });
      return;
    }

    const name = interaction.fields.getTextInputValue('name');
    const emojiRaw = interaction.fields.getTextInputValue('emoji');
    const formText = interaction.fields.getTextInputValue('form');

    pending.name = name;
    pending.emoji = emojiRaw && emojiRaw.trim().length > 0 ? emojiRaw.trim() : null;
    pending.formText = formText;
    pendingCategoryCreate.set(key, pending);

    const menu = new RoleSelectMenuBuilder()
      .setCustomId('setup:category_roles_create')
      .setPlaceholder('Kategori yetkili rollerini seçiniz')
      .setMinValues(1)
      .setMaxValues(25);

    await interaction.reply({
      content: 'Kategori için yetkili rollerini seçiniz.',
      components: [new ActionRowBuilder().addComponents(menu), buildSetupBackRow()],
      ephemeral: true
    });
    return;
  }

  if (interaction.customId === 'setup:category_edit_modal') {
    const key = `${guildId}:${interaction.user.id}`;
    const pending = pendingCategoryEdit.get(key);
    if (!pending) {
      await interaction.reply({ content: 'Bekleyen kategori düzenleme bulunamadı.', ephemeral: true });
      return;
    }

    const name = interaction.fields.getTextInputValue('name');
    const emojiRaw = interaction.fields.getTextInputValue('emoji');
    const formText = interaction.fields.getTextInputValue('form');

    pending.updates = {
      name: name && name.trim().length > 0 ? name.trim() : null,
      emoji: emojiRaw && emojiRaw.trim().length > 0 ? emojiRaw.trim() : null,
      formText: formText && formText.trim().length > 0 ? formText : null
    };

    pendingCategoryEdit.set(key, pending);

    await interaction.reply({
      content: 'Discord kategori kanalını seçiniz. (Değiştirmek istemiyorsanız mevcut olanı seçiniz.)',
      components: [...buildCategoryParentSelectComponents('setup:category_edit_parent'), buildSetupBackRow()],
      ephemeral: true
    });
    return;
  }

  await interaction.reply({ content: 'Bilinmeyen form gönderimi.', ephemeral: true });
}

async function handleCommand({ interaction, client, db }) {
  const guildId = interaction.guildId;
  const member = interaction.member;

  const guildSettings = db.getGuildSettings(guildId);
  if (!canUseSetup({ member, guildSettings })) {
    await interaction.reply({ content: 'Bu komutu kullanmak için yetkiniz yok.', ephemeral: true });
    return;
  }

  await interaction.reply({ ...buildSetupMainMenuResponse(null), ephemeral: true });
}

async function buildTranscriptText(channel) {
  const all = [];

  let lastId = null;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId || undefined }).catch(() => null);
    if (!batch || batch.size === 0) break;

    const messages = Array.from(batch.values());
    all.push(...messages);
    lastId = messages[messages.length - 1].id;

    if (batch.size < 100) break;
    if (all.length >= 1000) break;
  }

  all.reverse();

  const lines = [];
  for (const msg of all) {
    const ts = new Date(msg.createdTimestamp).toISOString();
    const author = msg.author ? `${msg.author.tag}` : 'Unknown';
    const content = msg.content || '';
    const attachmentUrls = msg.attachments.size > 0 ? Array.from(msg.attachments.values()).map((a) => a.url).join(' ') : '';
    lines.push(`[${ts}] ${author}: ${content}${attachmentUrls ? ` ${attachmentUrls}` : ''}`);
  }

  return lines.join('\n');
}

function normalizeChannelName(input) {
  const s = String(input || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!s) return null;
  return s.slice(0, 90);
}

function buildSafeChannelNameFallback() {
  return 'mryex-ticket';
}

async function closeTicketRecord({ client, db, ticket }) {
  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    db.closeTicket({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number });
    return { status: 'missing_channel' };
  }

  const transcript = await buildTranscriptText(channel);
  db.saveTranscript({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number, content: transcript });

  const fileName = `transcript-ticket-${ticket.ticket_number}.txt`;
  const buffer = Buffer.from(transcript || '', 'utf8');

  await channel.permissionOverwrites.edit(ticket.user_id, { ViewChannel: false }).catch(() => null);
  await channel.send({ files: [{ attachment: buffer, name: fileName }] }).catch(() => null);

  db.closeTicket({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number });
  await channel.send({ content: 'Ticket kapatılmıştır.', components: buildTicketButtonsClosed() }).catch(() => null);

  return { status: 'closed' };
}

function buildTicketEmbed({ ticketNumber, categoryName, openerId, createdAtMs }) {
  const unix = Math.floor(createdAtMs / 1000);

  const embed = new EmbedBuilder()
    .addFields(
      { name: 'Ticket ID', value: String(ticketNumber), inline: true },
      { name: 'Ticket Türü', value: categoryName, inline: true },
      { name: 'Açan Kullanıcı', value: `<@${openerId}>`, inline: false },
      { name: 'Açılış Zamanı', value: `<t:${unix}:F>`, inline: false }
    );

  return embed;
}

function buildTicketPermissionOverwrites({ guildId, botUserId, openerId, categoryRoleIds, extraUserIds = [], extraRoleIds = [] }) {
  const overwrites = [];

  overwrites.push({
    id: guildId,
    deny: [PermissionFlagsBits.ViewChannel]
  });

  overwrites.push({
    id: botUserId,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
  });

  overwrites.push({
    id: openerId,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
  });

  for (const roleId of categoryRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  for (const userId of extraUserIds) {
    overwrites.push({
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  for (const roleId of extraRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  return overwrites;
}

function isStaffForTicket({ member, guildSettings, categoryRoleIds }) {
  const adminRoleIds = parseJsonArray(guildSettings.admin_role_ids);
  if (adminRoleIds.length > 0 && memberHasAnyRole(member, adminRoleIds)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (memberHasAnyRole(member, categoryRoleIds)) return true;
  return false;
}

async function handleTicketPanelSelect({ interaction, client, db }) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const existingOpen = db.getOpenTicketByUser(guildId, userId);
  if (existingOpen) {
    await interaction.reply({ content: 'Lütfen önce mevcut ticketinizi kapatın.', ephemeral: true });
    return;
  }

  const categoryId = interaction.values[0];
  const category = db.getCategory(guildId, categoryId);
  if (!category) {
    await interaction.reply({ content: 'Kategori bulunamadı.', ephemeral: true });
    return;
  }

  const categoryRoleIds = db.getCategoryRoleIds(categoryId);
  if (categoryRoleIds.length < 1) {
    await interaction.reply({ content: 'Bu kategori için yetkili rol bulunamadı.', ephemeral: true });
    return;
  }

  const ticketNumber = db.nextTicketNumber(guildId);

  const guildSettings = db.getGuildSettings(guildId);
  const namingMode = guildSettings.ticket_channel_naming || 'number';

  const guild = interaction.guild;
  let namePreferred = null;
  if (namingMode === 'user') {
    namePreferred = normalizeChannelName(interaction.user.username);
  } else {
    namePreferred = normalizeChannelName(`ticket-${ticketNumber}`);
  }

  let channel = null;
  try {
    channel = await guild.channels.create({
      name: namePreferred || buildSafeChannelNameFallback(),
      type: ChannelType.GuildText,
      parent: category.parent_category_id,
      permissionOverwrites: buildTicketPermissionOverwrites({ guildId, botUserId: client.user.id, openerId: userId, categoryRoleIds })
    });
  } catch {
    channel = await guild.channels.create({
      name: buildSafeChannelNameFallback(),
      type: ChannelType.GuildText,
      parent: category.parent_category_id,
      permissionOverwrites: buildTicketPermissionOverwrites({ guildId, botUserId: client.user.id, openerId: userId, categoryRoleIds })
    });
  }

  db.createTicket({
    guildId,
    ticketNumber,
    userId,
    channelId: channel.id,
    categoryId
  });

  const mentionRoles = categoryRoleIds.map((r) => `<@&${r}>`).join(' ');

  const embed = buildTicketEmbed({
    ticketNumber,
    categoryName: category.name,
    openerId: userId,
    createdAtMs: Date.now()
  });

  await channel.send({ content: mentionRoles, embeds: [embed] });
  await channel.send({ content: category.form_text });
  await channel.send({ components: buildTicketButtonsOpen() });

  await interaction.reply({ content: `Ticket oluşturuldu: <#${channel.id}>`, ephemeral: true });
}

async function closeTicketFromChannel({ interaction, client, db }) {
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: 'Ticket bulunamadı.', ephemeral: true });
    return;
  }

  if (ticket.status !== 'open') {
    await interaction.reply({ content: 'Ticket zaten kapalı.', ephemeral: true });
    return;
  }

  const guildSettings = db.getGuildSettings(ticket.guild_id);
  const category = db.getCategory(ticket.guild_id, ticket.category_id);
  const categoryRoleIds = db.getCategoryRoleIds(ticket.category_id);

  const member = interaction.member;
  const isOpener = interaction.user.id === ticket.user_id;
  const staff = isStaffForTicket({ member, guildSettings, categoryRoleIds });

  if (!isOpener && !staff) {
    await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.channel;

  const transcript = await buildTranscriptText(channel);
  db.saveTranscript({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number, content: transcript });

  const fileName = `transcript-ticket-${ticket.ticket_number}.txt`;
  const buffer = Buffer.from(transcript || '', 'utf8');

  await channel.permissionOverwrites.edit(ticket.user_id, { ViewChannel: false }).catch(() => null);

  await channel.send({ files: [{ attachment: buffer, name: fileName }] });

  db.closeTicket({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number });

  await channel.send({ content: 'Ticket kapatılmıştır.', components: buildTicketButtonsClosed() });

  await interaction.editReply({ content: 'Ticket kapatıldı.' });
}

async function reopenTicketFromChannel({ interaction, client, db }) {
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: 'Ticket bulunamadı.', ephemeral: true });
    return;
  }

  if (ticket.status !== 'closed') {
    await interaction.reply({ content: 'Ticket zaten açık.', ephemeral: true });
    return;
  }

  const guildSettings = db.getGuildSettings(ticket.guild_id);
  const categoryRoleIds = db.getCategoryRoleIds(ticket.category_id);
  const member = interaction.member;

  if (!isStaffForTicket({ member, guildSettings, categoryRoleIds })) {
    await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  db.reopenTicket({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number });

  const channel = interaction.channel;

  await channel.permissionOverwrites.edit(ticket.user_id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  }).catch(() => null);

  await channel.send({ content: 'Ticket yeniden açılmıştır.', components: buildTicketButtonsOpen() });

  await interaction.editReply({ content: 'Ticket yeniden açıldı.' });
}

async function deleteTicketChannel({ interaction, client, db }) {
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: 'Ticket bulunamadı.', ephemeral: true });
    return;
  }

  const guildSettings = db.getGuildSettings(ticket.guild_id);
  const categoryRoleIds = db.getCategoryRoleIds(ticket.category_id);
  const member = interaction.member;

  if (!isStaffForTicket({ member, guildSettings, categoryRoleIds })) {
    await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: 'Ticket siliniyor.', ephemeral: true });

  await interaction.channel.delete().catch(() => null);
}

async function showAddStaffMenus({ interaction }) {
  const userMenu = new UserSelectMenuBuilder()
    .setCustomId('ticket:add_users')
    .setPlaceholder('Eklenecek kullanıcıları seçiniz')
    .setMinValues(1)
    .setMaxValues(10);

  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId('ticket:add_roles')
    .setPlaceholder('Eklenecek rolleri seçiniz')
    .setMinValues(1)
    .setMaxValues(10);

  await interaction.reply({
    content: 'Eklenecek kullanıcıları ve/veya rolleri seçiniz.',
    components: [new ActionRowBuilder().addComponents(userMenu), new ActionRowBuilder().addComponents(roleMenu)],
    ephemeral: true
  });
}

async function showRemoveStaffMenus({ interaction }) {
  const userMenu = new UserSelectMenuBuilder()
    .setCustomId('ticket:remove_users')
    .setPlaceholder('Çıkarılacak kullanıcıları seçiniz')
    .setMinValues(1)
    .setMaxValues(10);

  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId('ticket:remove_roles')
    .setPlaceholder('Çıkarılacak rolleri seçiniz')
    .setMinValues(1)
    .setMaxValues(10);

  await interaction.reply({
    content: 'Çıkarılacak kullanıcıları ve/veya rolleri seçiniz.',
    components: [new ActionRowBuilder().addComponents(userMenu), new ActionRowBuilder().addComponents(roleMenu)],
    ephemeral: true
  });
}

async function applyExtraUsers({ interaction, db, mode }) {
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: 'Ticket bulunamadı.', ephemeral: true });
    return;
  }

  const guildSettings = db.getGuildSettings(ticket.guild_id);
  const categoryRoleIds = db.getCategoryRoleIds(ticket.category_id);

  if (!isStaffForTicket({ member: interaction.member, guildSettings, categoryRoleIds })) {
    await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', ephemeral: true });
    return;
  }

  const userIds = interaction.values;

  if (mode === 'add') {
    db.addExtraUsers({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number, userIds });
    for (const userId of userIds) {
      await interaction.channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => null);
    }

    await interaction.reply({ content: 'Kullanıcı(lar) eklendi.', ephemeral: true });
    return;
  }

  db.removeExtraUsers({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number, userIds });
  for (const userId of userIds) {
    await interaction.channel.permissionOverwrites.delete(userId).catch(() => null);
  }

  await interaction.reply({ content: 'Kullanıcı(lar) çıkarıldı.', ephemeral: true });
}

async function applyExtraRoles({ interaction, db, mode }) {
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: 'Ticket bulunamadı.', ephemeral: true });
    return;
  }

  const guildSettings = db.getGuildSettings(ticket.guild_id);
  const categoryRoleIds = db.getCategoryRoleIds(ticket.category_id);

  if (!isStaffForTicket({ member: interaction.member, guildSettings, categoryRoleIds })) {
    await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', ephemeral: true });
    return;
  }

  const roleIds = interaction.values;

  if (mode === 'add') {
    db.addExtraRoles({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number, roleIds });
    for (const roleId of roleIds) {
      await interaction.channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => null);
    }

    await interaction.reply({ content: 'Rol(ler) eklendi.', ephemeral: true });
    return;
  }

  db.removeExtraRoles({ guildId: ticket.guild_id, ticketNumber: ticket.ticket_number, roleIds });
  for (const roleId of roleIds) {
    if (categoryRoleIds.includes(roleId)) continue;
    await interaction.channel.permissionOverwrites.delete(roleId).catch(() => null);
  }

  await interaction.reply({ content: 'Rol(ler) çıkarıldı.', ephemeral: true });
}

async function handleRoleSelect({ interaction, client, db }) {
  const guildId = interaction.guildId;

  if (interaction.customId === 'setup:admin_roles') {
    db.setAdminRoleIds(guildId, interaction.values);
    await interaction.update(buildSetupMainMenuResponse('Yetkili roller kaydedildi.'));
    return;
  }

  if (interaction.customId === 'setup:category_roles_create') {
    const key = `${guildId}:${interaction.user.id}`;
    const pending = pendingCategoryCreate.get(key);
    if (!pending) {
      await interaction.update(buildSetupMainMenuResponse('Bekleyen kategori bulunamadı.'));
      return;
    }

    if (db.listCategories(guildId).length >= 25) {
      pendingCategoryCreate.delete(key);
      await interaction.update(buildSetupMainMenuResponse('Discord select menü limiti nedeniyle en fazla 25 kategori kullanılabilir.'));
      return;
    }

    if (!pending.parentCategoryId || !pending.name || !pending.formText) {
      await interaction.update(buildSetupMainMenuResponse('Kategori bilgileri eksik.'));
      return;
    }

    const id = generateId();
    db.createCategory({
      id,
      guildId,
      name: pending.name,
      emoji: pending.emoji,
      parentCategoryId: pending.parentCategoryId,
      formText: pending.formText,
      roleIds: interaction.values
    });

    pendingCategoryCreate.delete(key);
    await tryUpdatePanelMessage({ client, db, guildId });

    await interaction.update(buildSetupMainMenuResponse(`Kategori kaydedildi. ID: ${id}`));
    return;
  }

  if (interaction.customId === 'setup:category_roles_update') {
    const key = `${guildId}:${interaction.user.id}`;
    const pending = pendingCategoryRoleUpdate.get(key);
    if (!pending) {
      await interaction.update(buildSetupMainMenuResponse('Bekleyen kategori rol güncellemesi bulunamadı.'));
      return;
    }

    db.setCategoryRoles({ categoryId: pending.categoryId, roleIds: interaction.values });
    pendingCategoryRoleUpdate.delete(key);

    await tryUpdatePanelMessage({ client, db, guildId });

    await interaction.update(buildSetupMainMenuResponse('Kategori yetkili rolleri güncellendi.'));
    return;
  }

  await interaction.reply({ content: 'Bilinmeyen rol seçimi.', ephemeral: true });
}

async function handleInteraction({ interaction, client, db }) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'kurulum') {
      await handleCommand({ interaction, client, db });
      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'ticket:panel') {
      await handleTicketPanelSelect({ interaction, client, db });
      return;
    }

    if (interaction.customId === 'setup:category_edit_select') {
      await handleSetupCategoryEditSelect({ interaction, db });
      return;
    }

    if (interaction.customId === 'setup:category_roles_select') {
      await handleSetupCategoryRolesSelect({ interaction, db });
      return;
    }

    if (interaction.customId === 'setup:category_delete_select') {
      await handleSetupCategoryDeleteSelect({ interaction, client, db });
      return;
    }
  }

  if (interaction.isChannelSelectMenu()) {
    await handleSetupChannelSelect({ interaction, client, db });
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleSetupModalSubmit({ interaction, db });
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    if (interaction.customId === 'ticket:add_roles') {
      await applyExtraRoles({ interaction, db, mode: 'add' });
      return;
    }
    if (interaction.customId === 'ticket:remove_roles') {
      await applyExtraRoles({ interaction, db, mode: 'remove' });
      return;
    }

    await handleRoleSelect({ interaction, client, db });
    return;
  }

  if (interaction.isUserSelectMenu()) {
    if (interaction.customId === 'ticket:add_users') {
      await applyExtraUsers({ interaction, db, mode: 'add' });
      return;
    }
    if (interaction.customId === 'ticket:remove_users') {
      await applyExtraUsers({ interaction, db, mode: 'remove' });
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('setup:')) {
      await handleSetupButton({ interaction, client, db });
      return;
    }

    if (interaction.customId === 'ticket:close') {
      await closeTicketFromChannel({ interaction, client, db });
      return;
    }

    if (interaction.customId === 'ticket:reopen') {
      await reopenTicketFromChannel({ interaction, client, db });
      return;
    }

    if (interaction.customId === 'ticket:delete') {
      await deleteTicketChannel({ interaction, client, db });
      return;
    }

    if (interaction.customId === 'ticket:add') {
      const ticket = db.getTicketByChannel(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: 'Ticket bulunamadı.', ephemeral: true });
        return;
      }

      const guildSettings = db.getGuildSettings(ticket.guild_id);
      const categoryRoleIds = db.getCategoryRoleIds(ticket.category_id);

      if (!isStaffForTicket({ member: interaction.member, guildSettings, categoryRoleIds })) {
        await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', ephemeral: true });
        return;
      }

      await showAddStaffMenus({ interaction });
      return;
    }

    if (interaction.customId === 'ticket:remove') {
      const ticket = db.getTicketByChannel(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: 'Ticket bulunamadı.', ephemeral: true });
        return;
      }

      const guildSettings = db.getGuildSettings(ticket.guild_id);
      const categoryRoleIds = db.getCategoryRoleIds(ticket.category_id);

      if (!isStaffForTicket({ member: interaction.member, guildSettings, categoryRoleIds })) {
        await interaction.reply({ content: 'Bu işlemi yapmak için yetkiniz yok.', ephemeral: true });
        return;
      }

      await showRemoveStaffMenus({ interaction });
      return;
    }
  }
}

module.exports = {
  handleInteraction
};
