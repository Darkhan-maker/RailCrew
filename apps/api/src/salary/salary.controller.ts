import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateSalaryRuleDtoSchema,
  UpdateSalaryRuleDtoSchema,
  CreateSalaryRuleDto,
  UpdateSalaryRuleDto,
} from '@railcrew/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SalaryService } from './salary.service';

@ApiTags('salary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('salary/rules')
export class SalaryController {
  constructor(private readonly salaryService: SalaryService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(CreateSalaryRuleDtoSchema)) dto: CreateSalaryRuleDto,
  ) {
    return this.salaryService.create(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtUser) {
    return this.salaryService.findAll(user.userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSalaryRuleDtoSchema)) dto: UpdateSalaryRuleDto,
  ) {
    return this.salaryService.update(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.salaryService.remove(user.userId, id);
  }
}
