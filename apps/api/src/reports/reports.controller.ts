import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { RequirePermissions } from '../common/decorators';
import { ReportsService } from './reports.service';

class SummaryQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermissions('reports.read')
  summary(@Query() q: SummaryQuery) {
    return this.reports.summary(q.date);
  }
}
