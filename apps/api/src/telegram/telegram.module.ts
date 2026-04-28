import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TripsModule } from '../trips/trips.module';
import { TelegramService } from './telegram.service';
import { TelegramBot } from './telegram.bot';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [PrismaModule, TripsModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramBot],
})
export class TelegramModule {}
