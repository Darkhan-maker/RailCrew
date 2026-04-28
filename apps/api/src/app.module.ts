import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TripsModule } from './trips/trips.module';
import { SalaryModule } from './salary/salary.module';
import { SummaryModule } from './summary/summary.module';
import { ExportModule } from './export/export.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TripsModule,
    SalaryModule,
    SummaryModule,
    ExportModule,
    TelegramModule,
  ],
})
export class AppModule {}
