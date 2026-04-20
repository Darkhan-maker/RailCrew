import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ExportService } from './export.service';

@ApiTags('export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('trips/pdf')
  async exportPeriodPdf(
    @CurrentUser() user: JwtUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() reply: FastifyReply,
  ) {
    return this.exportService.exportPeriodPdf(user.userId, from, to, reply);
  }

  @Get('trips/xlsx')
  async exportPeriodXlsx(
    @CurrentUser() user: JwtUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() reply: FastifyReply,
  ) {
    return this.exportService.exportPeriodXlsx(user.userId, from, to, reply);
  }

  @Get('trips/:id/pdf')
  async exportOneTripPdf(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    return this.exportService.exportOneTripPdf(user.userId, id, reply);
  }
}
