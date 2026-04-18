# RailCrew

Мобильное приложение для локомотивных бригад (машинисты и помощники машинистов) — трекинг поездок и расчёт зарплаты.

## Стек

- **Monorepo**: pnpm workspaces
- **Mobile**: Expo / React Native + TypeScript (`apps/mobile`)
- **API**: NestJS (`apps/api`)
- **DB**: PostgreSQL + Prisma (`apps/api/prisma`)
- **Contracts**: Zod-схемы, общие типы и валидация (`packages/contracts`)

## Структура

```
├── apps/
│   ├── mobile/          # Expo React Native приложение
│   │   └── src/
│   │       ├── screens/ # Экраны (Dashboard, TripEntry, Settings и др.)
│   │       ├── components/
│   │       ├── hooks/
│   │       ├── services/
│   │       └── navigation/
│   └── api/             # NestJS backend
│       ├── src/
│       └── prisma/      # Prisma schema и миграции
├── packages/
│   └── contracts/       # @railcrew/contracts — Zod-схемы, DTO, типы
└── package.json         # Корневой pnpm workspace
```

## Архитектурные правила (СТРОГО)

1. **Все DTO и валидация ТОЛЬКО из `@railcrew/contracts`** — никаких параллельных или временных типов в mobile или api. Импорт: `import { ... } from '@railcrew/contracts'`
2. **Offline-first**: локальное хранение данных, синхронизация с сервером когда есть сеть
3. **Zod — единый источник истины** для типов и рантайм-валидации

## Реализованный функционал

- Ввод поездок: локомотив, показания электросчётчика, автоматический расчёт ночных часов
- Дашборд: прогресс месячной нормы часов, разбивка зарплаты
- Экран настроек
- Голосовой ввод поездок (regex-парсинг русского текста) — в разработке

## Команды

```bash
pnpm install          # Установка зависимостей
pnpm --filter mobile dev   # Запуск мобильного приложения
pnpm --filter api dev      # Запуск API
```

## Стиль ответов

- Полный код файлов, без сокращений
- Без пояснительного текста и обзоров
- Без списков удаления и команд verify
