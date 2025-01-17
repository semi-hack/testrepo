import { BadRequestException, forwardRef, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Transfer } from "../entities/transfer.entity";
import { Between, DataSource, LessThanOrEqual, MoreThanOrEqual, Repository } from "typeorm";
import { ServiceMethodOptions } from "src/shared/interfaces/service-method-options";
import { PaginatedResult } from "src/shared/interfaces/paginated-result.interface";
import { InitiateTransferInput } from "../interfaces/transfer.interface";
import { AccountService } from "../../../core/account/services/account.service";
import { UserService } from "../../../core/user/services/user.service";
import * as randomstring from 'randomstring';
import { Cache, CACHE_MANAGER } from "@nestjs/cache-manager";




@Injectable()
export class TransferService {
  constructor(
    private readonly datasource: DataSource,
    @InjectRepository(Transfer)
    private readonly transferRepo: Repository<Transfer>,
    @Inject(forwardRef(() => AccountService))
    private readonly accountService: AccountService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
  ) {
    
  }


  /**
   * Initiate a transfer
   * @param initiateTransferInput - The input needed to initiate a transfer
   * @returns The transfer object
   * @throws BadRequestException if the recipient is not found
   */
  async initiateTransfer(initiateTransferInput: InitiateTransferInput ) {
    const {  sender, amount, receiver} = initiateTransferInput
    return this.datasource.transaction(async (manager) => {
        const senderAccount = await this.userService.findByUserId(sender);
        const receiverAccount = await this.userService.findByUsername(receiver, true)

        if (!receiverAccount) {
            throw new BadRequestException('Recipient not found');
        }

        const balanceBefore = senderAccount.account.balance;
        const updatedSenderAccount = await this.accountService.debitAccount(senderAccount.account.id, amount, manager);
        await this.accountService.creditAccount(receiverAccount.account.id, amount, manager);

        const reference = randomstring.generate({
            length: 12,
            charset: 'alphanumeric'
        })

        const transfer = await this.transferRepo.create({
            sender: senderAccount,
            receiver: receiverAccount,
            amount: amount,
            reference,
            balanceBefore: balanceBefore,
            balanceAfter: updatedSenderAccount.balance
        })

        const savedTransfer = await manager.save(transfer)

        return savedTransfer
    })
  }

  /**
   * Initiates a transfer with retry mechanism
   * @param {InitiateTransferInput} initiateTransferInput - The input needed to initiate a transfer
   * @param {number} [retries=3] - The number of retry attempts
   * @returns {Promise<Transfer>} The saved transfer object
   * @throws {Error} If all retry attempts fail
   */

  async initiateTransferWithRetry(initiateTransferInput: InitiateTransferInput, retries: number = 3) {
    try {
      return await this.initiateTransfer(initiateTransferInput)
    } catch (error) {
      if (error.code === '40001' && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.initiateTransferWithRetry(initiateTransferInput, retries - 1);
      }
    }
  }
  
  /**
   * Builds a filter object based on the provided query parameters.
   * 
   * @param {Object} query - The query object containing filter parameters.
   * @param {string} [query.startPeriodDatetime] - The start date and time for filtering transfers.
   * @param {string} [query.endPeriodDatetime] - The end date and time for filtering transfers.
   * @returns {Object} The filter object to be used in database queries.
   */
  buildFilter(query: any) {
    const filter = {};

    if (query.startPeriodDatetime) {
      filter['createdAt'] = MoreThanOrEqual(query.startPeriodDatetime);
    }

    if (query.endPeriodDatetime) {
      filter['createdAt'] = LessThanOrEqual(query.endPeriodDatetime);
    }

    if (query.startPeriodDatetime && query.endPeriodDatetime) {
      filter['createdAt'] = Between(
        query.startPeriodDatetime,
        query.endPeriodDatetime,
      );
    }

    return filter;
  }

  /**
   * Finds transfers that match the query and returns a paginated result.
   * 
   * @param {ServiceMethodOptions} options - The options for the query.
   * @returns {Promise<PaginatedResult<Transfer>>} The paginated result of transfers.
   */
  async find(options: ServiceMethodOptions): Promise<PaginatedResult<Transfer>> {
    const { currentUser, query, pagination } = options;
    const filter = this.buildFilter(query);

    let transferQuery = this.transferRepo
      .createQueryBuilder('transfer')
      .skip(pagination.skip)
      .take(pagination.take)
      .where(filter)
      .andWhere('transfer.senderId = :userId OR transfer.receiverId = :userId', { userId: currentUser.id })
      .leftJoinAndSelect('transfer.sender', 'sender')
      .leftJoinAndSelect('transfer.receiver', 'receiver')
      .orderBy('transfer.createdAt', 'DESC')


    const [records, count] = await transferQuery.getManyAndCount();

    return { records, count };
  }


}
