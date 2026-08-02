import { Module } from '@nestjs/common';
import { BusinessHoursModule } from '../business-hours/business-hours.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { WhatsappController } from './whatsapp.controller';
import { ChannelRepository } from './channel.repository';
import { MerchantResolutionService } from './merchant-resolution.service';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository } from './messages.repository';
import { MemoryRepository } from './memory.repository';
import { IdentityRepository } from './identity.repository';
import { ConversationTurnsRepository } from './conversation-turns.repository';
import { TurnCommitRepository } from './turn-commit.repository';
import { MerchantConfigService } from './merchant-config.service';
import { OrderingWindowService } from './ordering-window.service';
import { SecurityService } from './security.service';
import { IntentService } from './intent.service';
import { MemoryService } from './memory.service';
import { ToolsService } from './tools.contract';
import { ToolLoopService } from './tool-loop.service';
import { ConversationLockService } from './conversation-lock.service';
import { TurnIntegrityService } from './turn-integrity.service';
import { TurnService } from './turn.service';
import { ProductsRepository } from './products.repository';
import { OrdersRepository } from './orders.repository';
import { RealToolsService } from './tools.service';
import { CatalogTools } from './tools/catalog.tools';
import { CartTools } from './tools/cart.tools';
import { CheckoutTools } from './tools/checkout.tools';
import { CustomerTools } from './tools/customer.tools';
import { LocationTools } from './tools/location.tools';
import { OrderLocationResolver } from './order-location.resolver';

/**
 * The conversational engine (ConversaFlow port, spec §3 Phase 3):
 *   3.0 — merchant resolution                                          [done]
 *   3a  — repositories + leaf services                               [done]
 *   3b  — turn engine: integrity + mini-harness loop + commit        [done]
 *   3c  — tools / product search / cart / ordering  (ToolsService stub for now)
 *   3d  — whatsapp.controller ingress (Twilio webhook)
 *
 * Providers are exported so the worker-side processors (turns/enrichment/
 * outbound) reuse the same services. ToolsService is bound to a stub until 3c
 * provides the real tool implementations.
 */
@Module({
  imports: [BusinessHoursModule, MerchantsModule],
  // The Twilio webhook ingress (web process only; the worker imports this module
  // for the services and never instantiates controllers).
  controllers: [WhatsappController],
  providers: [
    // merchant resolution (3.0)
    ChannelRepository,
    MerchantResolutionService,
    // repositories (3a + 3b)
    ConversationsRepository,
    MessagesRepository,
    MemoryRepository,
    IdentityRepository,
    ConversationTurnsRepository,
    TurnCommitRepository,
    // leaf services (3a)
    MerchantConfigService,
    OrderingWindowService,
    SecurityService,
    IntentService,
    MemoryService,
    // turn engine (3b)
    ToolLoopService,
    ConversationLockService,
    TurnIntegrityService,
    TurnService,
    // agent tools (3c) — RealToolsService replaces the stub
    ProductsRepository,
    OrdersRepository,
    OrderLocationResolver,
    CatalogTools,
    CartTools,
    CheckoutTools,
    CustomerTools,
    LocationTools,
    { provide: ToolsService, useClass: RealToolsService },
  ],
  exports: [
    ChannelRepository,
    MerchantResolutionService,
    ConversationsRepository,
    MessagesRepository,
    MemoryRepository,
    IdentityRepository,
    ConversationTurnsRepository,
    TurnCommitRepository,
    MerchantConfigService,
    OrderingWindowService,
    SecurityService,
    IntentService,
    MemoryService,
    ToolsService,
    ToolLoopService,
    ConversationLockService,
    TurnIntegrityService,
    TurnService,
    ProductsRepository,
    OrdersRepository,
  ],
})
export class ConversationsModule {}
