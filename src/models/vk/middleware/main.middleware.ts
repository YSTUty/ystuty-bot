import { Inject, Injectable, Logger } from '@nestjs/common';
import { VK_HEAR_MANAGER, VK_SCENE_MANAGER } from 'nestjs-vk';
import {
    MessageContext,
    Context,
    Composer,
    IMessageContextSendOptions,
    getRandomId,
} from 'vk-io';
import { HearManager } from '@vk-io/hear';
import { SessionManager } from '@vk-io/session';
import { SceneManager } from '@vk-io/scenes';
import { RedisStorage } from 'vk-io-redis-storage';
import { NextMiddleware, MiddlewareReturn } from 'middleware-io';
import { LocalePhrase } from '@my-interfaces';
import { IContext, IMessageContext } from '@my-interfaces/vk';
import * as xEnv from '@my-environment';

import { MetricsService } from '../../metrics/metrics.service';
import { VKKeyboardFactory } from '../vk-keyboard.factory';
import { i18n } from '../util/i18n.util';
import { checkLocaleCondition } from '../util/vk-menu.util';

@Injectable()
export class MainMiddleware {
    private readonly logger = new Logger(MainMiddleware.name);

    private readonly sessionManager: SessionManager;
    private readonly sessionConversationManager: SessionManager;

    private readonly redisStorage: RedisStorage;

    constructor(
        @Inject(VK_HEAR_MANAGER)
        private readonly hearManagerProvider: HearManager<MessageContext>,

        @Inject(VK_SCENE_MANAGER)
        private readonly sceneManager: SceneManager,

        private readonly keyboardFactory: VKKeyboardFactory,
        private readonly metricsService: MetricsService,
    ) {
        this.redisStorage = new RedisStorage({
            redis: {
                host: xEnv.REDIS_HOST,
                port: xEnv.REDIS_PORT,
                db: xEnv.REDIS_DATABASE,
                username: xEnv.REDIS_USER,
                password: xEnv.REDIS_PASSWORD,
            },
            ttl: 7 * 24 * 3600,
        });

        this.sessionManager = new SessionManager({
            storage: this.redisStorage,
            getStorageKey: (ctx: IContext) =>
                `${ctx.peerId}:${ctx.senderId || ctx.userId}`,
        });

        this.sessionConversationManager = new SessionManager({
            contextKey: 'sessionConversation',
            storage: this.redisStorage,
            getStorageKey: (ctx: IContext) => `conversation:${ctx.peerId}`,
        });
    }

    get middlewaresBefore() {
        const composer = Composer.builder<Context>();

        composer.use(this.featureMiddleware);
        composer.use(this.middlewareMetrics);
        composer.use(this.safeTextConverstionMiddleware);
        composer.use(this.sessionManager.middleware);
        composer.use(this.sessionConversationManager.middleware);
        composer.use(this.middlewareCleaner);
        composer.use(i18n.middleware);
        composer.use(this.sceneManager.middleware);

        return composer.compose();
    }

    get middlewaresAfter() {
        const composer = Composer.builder<Context>();

        composer.use(this.sceneInterceptMiddleware());
        composer.use(this.hearManagerProvider.middleware);

        return composer.compose();
    }

    private get middlewareMetrics() {
        return async (
            ctx: IContext,
            next: NextMiddleware,
        ): Promise<MiddlewareReturn> => {
            const { type: updateType } = ctx;
            const duration =
                this.metricsService.vkRequestDurationHistogram.startTimer({
                    updateType,
                });

            console.log('updateType', updateType);

            try {
                await next?.();
                this.metricsService.vkRequestCounter.inc({
                    updateType,
                    status: 'success',
                });
                duration({ status: 'success' });
            } catch (err) {
                this.metricsService.vkRequestCounter.inc({
                    updateType,
                    status: 'error',
                });
                duration({ status: 'error' });
                throw err;
            } finally {
                // duration();
            }
            return;
        };
    }

    private get featureMiddleware() {
        return async (
            ctx: IContext,
            next: NextMiddleware,
        ): Promise<MiddlewareReturn> => {
            if (ctx.isOutbox) {
                return;
            }
            if (ctx.is(['message'])) {
                // ...
            } else {
                // * safe `send` method for all context events
                ctx.send = (
                    text: string | IMessageContextSendOptions,
                    params?: IMessageContextSendOptions,
                ) =>
                    (ctx as any).api.messages.send({
                        random_id: getRandomId(),
                        peer_ids: ctx.peerId,
                        ...(typeof text === 'string'
                            ? { message: text, ...params }
                            : text),
                    });
            }

            try {
                await next();
            } catch (error) {
                this.logger.error('Error:', error);
            }
        };
    }

    public get middlewareCleaner() {
        return async (ctx: IContext, next: NextMiddleware) => {
            await next?.();
            this.cleanSession(ctx);
        };
    }

    private cleanSession(ctx: IContext) {
        const { session } = ctx;
        if (!session) return;

        // i18n
        if (session['__language_code'] === 'ru') {
            delete session['__language_code'];
        }
    }

    private get safeTextConverstionMiddleware() {
        return (ctx: IContext, next: NextMiddleware) => {
            const triggerRegexp = new RegExp(
                `^\\[club${ctx.$groupId}\\|(.*?)\\],? `,
                'i',
            );
            ctx.state.appeal = false;

            if (ctx.text && triggerRegexp.test(ctx.text)) {
                const triggerMsg = ctx.text.match(triggerRegexp);
                ctx.text = ctx.text.slice(triggerMsg[0].length);
                ctx.state.appeal = true;
            }
            return next();
        };
    }

    private sceneInterceptMiddleware() {
        return async (ctx: IMessageContext, next: NextMiddleware) => {
            if (!ctx.scene.current) {
                return next();
            }

            if (
                checkLocaleCondition([LocalePhrase.Button_Cancel])(
                    ctx.text,
                    ctx,
                )
            ) {
                const keyboard = this.keyboardFactory.getClose(ctx);
                ctx.send(ctx.i18n.t(LocalePhrase.Common_Canceled), {
                    keyboard,
                });
                return ctx.scene.leave({ canceled: true });
            }

            return ctx.scene.reenter();
        };
    }
}
