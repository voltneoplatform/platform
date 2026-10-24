import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStaff, RequirePermissions, type AuthenticatedStaff } from '../common/decorators';
import { FieldService } from './field.service';

@ApiTags('Field App')
@ApiBearerAuth()
@Controller('field')
export class FieldController {
  constructor(private readonly field: FieldService) {}

  @Get('summary')
  @RequirePermissions('field_app.access')
  summary(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.field.summary(staff);
  }

  @Get('cash')
  @RequirePermissions('payments.collect_cash')
  cash(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.field.myCash(staff);
  }

  @Get('recoveries')
  @RequirePermissions('recovery.record')
  recoveries() {
    return this.field.recoveryJobs();
  }
}
