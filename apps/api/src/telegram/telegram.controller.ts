import { Controller, Post, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @UseGuards(JwtAuthGuard)
  @Post('generate-code')
  async generateCode(@Request() req: { user: { userId: string } }): Promise<{ code: string }> {
    const code = await this.telegramService.generateLinkCode(req.user.userId);
    return { code };
  }
}
