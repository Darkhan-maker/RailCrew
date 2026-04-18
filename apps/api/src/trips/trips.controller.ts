import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateTripDtoSchema,
  UpdateTripDtoSchema,
  TripQuerySchema,
  CreateTripDto,
  UpdateTripDto,
  TripQuery,
} from '@railcrew/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TripsService } from './trips.service';

@ApiTags('trips')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(CreateTripDtoSchema)) dto: CreateTripDto,
  ) {
    return this.tripsService.create(user.userId, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtUser,
    @Query(new ZodValidationPipe(TripQuerySchema)) query: TripQuery,
  ) {
    return this.tripsService.findAll(user.userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.tripsService.findOne(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTripDtoSchema)) dto: UpdateTripDto,
  ) {
    return this.tripsService.update(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.tripsService.remove(user.userId, id);
  }
}
