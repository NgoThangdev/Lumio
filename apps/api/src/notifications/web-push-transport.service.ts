import { createECDH, timingSafeEqual } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';
import type {
  DeliverySubscription,
  PushTransport,
} from './notification-dispatch.service.js';
import {
  InvalidPushSubscriptionError,
  PermanentPushError,
  RetryablePushError,
} from './notification-dispatch.service.js';

type VapidConfiguration = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

type PushClient = Pick<typeof webPush, 'sendNotification'>;

const base64Url = /^[A-Za-z0-9_-]+$/;

export function parseVapidConfiguration(
  env: Record<string, string | undefined>,
): VapidConfiguration | null {
  const subject = env.VAPID_SUBJECT;
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return null;
  if (
    subject.length > 255 ||
    !base64Url.test(publicKey) ||
    !base64Url.test(privateKey)
  )
    return null;
  try {
    const contact = new URL(subject);
    if (!(
      (contact.protocol === 'mailto:' &&
        /^[^@\s]+@[^@\s.]+\.[^@\s.]+$/.test(contact.pathname)) ||
      (contact.protocol === 'https:' &&
        contact.hostname !== 'localhost' &&
        contact.hostname.includes('.'))
    ))
      return null;
    const decodedPublic = Buffer.from(publicKey, 'base64url');
    const decodedPrivate = Buffer.from(privateKey, 'base64url');
    if (
      decodedPublic.length !== 65 ||
      decodedPublic[0] !== 4 ||
      decodedPrivate.length !== 32 ||
      decodedPublic.toString('base64url') !== publicKey ||
      decodedPrivate.toString('base64url') !== privateKey
    )
      return null;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(decodedPrivate);
    const derived = ecdh.getPublicKey(undefined, 'uncompressed');
    if (!timingSafeEqual(decodedPublic, derived)) return null;
    return { subject, publicKey, privateKey };
  } catch {
    return null;
  }
}

@Injectable()
export class WebPushConfiguration {
  private readonly values: VapidConfiguration | null;

  constructor() {
    loadEnv({
      path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
      quiet: true,
    });
    this.values = parseVapidConfiguration(process.env);
  }

  configuration() {
    return this.values;
  }

  publicState() {
    return this.values
      ? { available: true, publicKey: this.values.publicKey }
      : { available: false, publicKey: null, reason: 'WEB_PUSH_UNAVAILABLE' };
  }
}

function payload(content: unknown): string {
  if (!content || typeof content !== 'object' || Array.isArray(content))
    throw new PermanentPushError('INVALID_PUSH_CONTENT');
  const value = content as Record<string, unknown>;
  let url: string;
  if (
    typeof value.signal === 'string' &&
    typeof value.householdId === 'string' &&
    typeof value.itemId === 'string'
  ) {
    url = `/households/${encodeURIComponent(value.householdId)}/inventory/${encodeURIComponent(value.itemId)}`;
  } else if (Array.isArray(value.households)) {
    url = '/attention';
  } else {
    throw new PermanentPushError('INVALID_PUSH_CONTENT');
  }
  return JSON.stringify({
    title: 'Lumio',
    body: 'Open Lumio to review stock.',
    url,
  });
}

function responseStatus(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('statusCode' in value))
    return null;
  const status = value.statusCode;
  return typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : null;
}

function classifyResponse(status: number): Error {
  if (status === 404 || status === 410)
    return new InvalidPushSubscriptionError('SUBSCRIPTION_INVALID');
  if (status === 408 || status === 429 || status >= 500)
    return new RetryablePushError('PUSH_SERVICE_RETRYABLE');
  return new PermanentPushError('PUSH_SERVICE_REJECTED');
}

@Injectable()
export class WebPushTransport implements PushTransport {
  constructor(
    private readonly configurationService: WebPushConfiguration,
    @Inject('WEB_PUSH_CLIENT') private readonly client: PushClient,
  ) {}

  isAvailable() {
    return this.configurationService.configuration() !== null;
  }

  async send(subscription: DeliverySubscription, content: unknown) {
    const vapidDetails = this.configurationService.configuration();
    if (!vapidDetails) throw new PermanentPushError('WEB_PUSH_UNAVAILABLE');
    const message = payload(content);
    try {
      const response = await this.client.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        message,
        { vapidDetails, TTL: 300, timeout: 10_000 },
      );
      if (response.statusCode < 200 || response.statusCode >= 300)
        throw classifyResponse(response.statusCode);
    } catch (error) {
      if (
        error instanceof InvalidPushSubscriptionError ||
        error instanceof RetryablePushError ||
        error instanceof PermanentPushError
      )
        throw error;
      const status = responseStatus(error);
      if (status !== null) throw classifyResponse(status);
      // A network error without a service response may have happened after
      // acceptance. The dispatcher leaves the claim UNKNOWN, never auto-retries.
      throw new Error('PUSH_ACK_UNKNOWN');
    }
  }
}

export const webPushClientProvider = {
  provide: 'WEB_PUSH_CLIENT',
  useValue: webPush,
};
