import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VoiceInputDtoSchema, VoiceInputDto } from '@railcrew/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('voice')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @Post('parse')
  parse(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(VoiceInputDtoSchema)) dto: VoiceInputDto,
  ) {
    return this.voiceService.parse(dto.rawText, user.userId);
  }
}
