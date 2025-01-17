import {
  Body,
  Controller,
  forwardRef,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccountService } from '../services/account.service';
import { JWTHTTPAuthGuard } from '../../../shared/guards/auth.guard';
import { SuccessResponse } from '../../../shared/utils/response.util';
import { FundAccountDto } from '../dto/account.dto';
import { ApiTags } from '@nestjs/swagger';

@Controller('accounts')
export class AccountController {
  constructor(
    @Inject(forwardRef(() => AccountService))
    private readonly accountService: AccountService,
  ) {}

  /**
   * Funds an account
   * @param req - The request object
   * @param body - The body object
   * @returns { object } - The response object
   */
  @Post('fund')
  @ApiTags('Account')
  @UseGuards(JWTHTTPAuthGuard)
  async initiate(@Req() req: any, @Body() body: FundAccountDto) {
    const { currentUser } = req;
    await this.accountService.fundAccount(currentUser.account.id, body.amount);
    return SuccessResponse('Successful');
  }
}
