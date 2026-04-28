import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { TelegramService } from './telegram.service';

const HELP_TEXT = `
📋 *Команды бота*

/start — приветствие
/link <код> — привязать аккаунт RailCrew
/list — последние 5 поездок
/help — эта справка

*Создание поездки*
Просто отправь сообщение в формате:
\`Астана-Алматы 7 апреля явка 08:00 сдача 16:30 грузовой ВЛ80 569\`

*Типы поездок:*
грузовой / пассажирский / маневровый / резервом

*Локомотив:* модель и номер в конце
`.trim();

const START_TEXT = `
👋 Привет! Я бот *RailCrew*.

Я помогаю машинистам быстро создавать записи о поездках.

*Для начала работы* привяжи аккаунт:
1. Открой приложение RailCrew
2. Перейди в *Профиль → Telegram*
3. Нажми «Получить код»
4. Отправь мне: /link <код>

После привязки просто пиши мне о поездке, и я её сохраню!

/help — подробная справка
`.trim();

@Injectable()
export class TelegramBot implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBot.name);
  private bot: Telegraf | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly telegramService: TelegramService,
  ) {}

  async onModuleInit() {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
      return;
    }

    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);

    this.bot.launch()
      .then(() => this.logger.log('Telegram bot launched'))
      .catch((err: unknown) => this.logger.error('Bot launch failed', err));
  }

  async onModuleDestroy() {
    this.bot?.stop('SIGTERM');
  }

  private registerHandlers(bot: Telegraf) {
    bot.start((ctx: Context) => {
      ctx.replyWithMarkdown(START_TEXT).catch(() => {});
    });

    bot.help((ctx: Context) => {
      ctx.replyWithMarkdown(HELP_TEXT).catch(() => {});
    });

    bot.command('link', async (ctx: Context) => {
      const text = (ctx.message as any)?.text ?? '';
      const parts = text.trim().split(/\s+/);
      const code = parts[1];

      if (!code || !/^\d{6}$/.test(code)) {
        ctx.reply('❌ Укажи 6-значный код: /link 123456').catch(() => {});
        return;
      }

      const telegramId = String(ctx.from?.id);
      const name = await this.telegramService.linkByCode(code, telegramId);

      if (!name) {
        ctx.reply('❌ Код не найден или истёк. Получи новый код в приложении.').catch(() => {});
        return;
      }

      ctx.replyWithMarkdown(`✅ Аккаунт привязан, *${name}*!\n\nТеперь ты можешь создавать поездки прямо здесь.\n\n${HELP_TEXT}`).catch(() => {});
    });

    bot.command('list', async (ctx: Context) => {
      const telegramId = String(ctx.from?.id);
      const user = await this.telegramService.findUserByTelegramId(telegramId);

      if (!user) {
        ctx.reply('❌ Аккаунт не привязан. Отправь /start для инструкции.').catch(() => {});
        return;
      }

      const trips = await this.telegramService.getRecentTrips(user.id);

      if (trips.length === 0) {
        ctx.reply('📭 Поездок пока нет.').catch(() => {});
        return;
      }

      const TYPE_EMOJI: Record<string, string> = {
        FREIGHT: '🚂',
        PASSENGER: '🚆',
        SHUNTING: '🔄',
        DEAD_RUN: '🔷',
      };

      const lines = trips.map((tr: any, i: number) => {
        const emoji = TYPE_EMOJI[tr.tripType] ?? '🚃';
        const loco = tr.locoModel ? ` · ${tr.locoModel}${tr.locoNumber ? ` №${tr.locoNumber}` : ''}` : '';
        const dur = tr.durationMinutes ? ` · ${Math.floor(tr.durationMinutes / 60)}ч ${tr.durationMinutes % 60}м` : '';
        return `${i + 1}. ${emoji} *${tr.routeFrom} → ${tr.routeTo}*\n   📅 ${tr.date} · ${tr.startTime}–${tr.endTime}${dur}${loco}`;
      });

      ctx.replyWithMarkdown(`📋 *Последние поездки:*\n\n${lines.join('\n\n')}`).catch(() => {});
    });

    bot.on('text', async (ctx: Context) => {
      const text = (ctx.message as any)?.text ?? '';

      // Ignore commands
      if (text.startsWith('/')) return;

      const telegramId = String(ctx.from?.id);
      const user = await this.telegramService.findUserByTelegramId(telegramId);

      if (!user) {
        ctx.reply('❌ Аккаунт не привязан. Отправь /start для инструкции.').catch(() => {});
        return;
      }

      const result = await this.telegramService.createTripFromText(user.id, text);

      if (!result.ok) {
        ctx.reply(`❌ ${result.error}`).catch(() => {});
        return;
      }

      const tr = result.trip as any;
      const TYPE_LABEL: Record<string, string> = {
        FREIGHT: 'Грузовой', PASSENGER: 'Пассажирский',
        SHUNTING: 'Маневровый', DEAD_RUN: 'Резервом',
      };
      const loco = tr.locoModel ? `🚂 ${tr.locoModel}${tr.locoNumber ? ` №${tr.locoNumber}` : ''}\n` : '';
      const dur = tr.durationMinutes
        ? `⏱ ${Math.floor(tr.durationMinutes / 60)}ч ${tr.durationMinutes % 60}м\n`
        : '';

      ctx.replyWithMarkdown(
        `✅ *Поездка сохранена!*\n\n` +
        `🗺 *${tr.routeFrom} → ${tr.routeTo}*\n` +
        `📅 ${tr.date} · ${tr.startTime}–${tr.endTime}\n` +
        `${dur}` +
        `${loco}` +
        `📌 ${TYPE_LABEL[tr.tripType] ?? tr.tripType}`,
      ).catch(() => {});
    });
  }
}
