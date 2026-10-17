import { createECDH } from 'node:crypto';
import {
  InvalidPushSubscriptionError,
  PermanentPushError,
  RetryablePushError,
} from './notification-dispatch.service.js';
import {
  parseVapidConfiguration,
  WebPushConfiguration,
  WebPushTransport,
} from './web-push-transport.service.js';

const subscription = {
  endpoint: 'https://push.example.invalid/device',
  p256dh: 'browser-public-key',
  auth: 'browser-auth-secret',
};
const content = { signal: 'OUT', householdId: 'home', itemId: 'item' };

function setup(configured = true) {
  const configuration = configured
    ? {
        subject: 'mailto:ops@example.invalid',
        publicKey: 'public-test-value',
        privateKey: 'private-test-value',
      }
    : null;
  const client = {
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  };
  const transport = new WebPushTransport(
    { configuration: () => configuration } as never,
    client as never,
  );
  return { client, transport };
}

describe('Web Push transport', () => {
  it('accepts a mocked push-service response and sends only a minimal payload', async () => {
    const { client, transport } = setup();
    expect(transport.isAvailable()).toBe(true);
    await expect(
      transport.send(subscription, content),
    ).resolves.toBeUndefined();
    const [, payload, options] = client.sendNotification.mock.calls[0] as [
      unknown,
      string,
      { TTL: number; timeout: number; vapidDetails: unknown },
    ];
    expect(JSON.parse(payload)).toEqual({
      title: 'Lumio',
      body: 'Open Lumio to review stock.',
      url: '/households/home/inventory/item',
    });
    expect(options).toMatchObject({ TTL: 300, timeout: 10_000 });
  });

  it('links a digest to the same-origin attention page', async () => {
    const { client, transport } = setup();
    await transport.send(subscription, {
      households: [
        {
          householdId: 'home',
          items: [{ itemId: 'item', signals: ['LOW_STOCK'] }],
        },
      ],
    });
    const payload = client.sendNotification.mock.calls[0][1] as string;
    expect(JSON.parse(payload)).toEqual({
      title: 'Lumio',
      body: 'Open Lumio to review stock.',
      url: '/attention',
    });
  });

  it.each([408, 429, 500, 503])(
    'retries a definite %i push-service response',
    async (statusCode) => {
      const { client, transport } = setup();
      client.sendNotification.mockRejectedValue({
        statusCode,
        body: 'do not log',
      });
      await expect(
        transport.send(subscription, content),
      ).rejects.toBeInstanceOf(RetryablePushError);
    },
  );

  it.each([404, 410])(
    'marks a %i subscription rejection as invalid',
    async (statusCode) => {
      const { client, transport } = setup();
      client.sendNotification.mockRejectedValue({ statusCode });
      await expect(
        transport.send(subscription, content),
      ).rejects.toBeInstanceOf(InvalidPushSubscriptionError);
    },
  );

  it.each([400, 401, 403])(
    'does not retry a definite %i rejection',
    async (statusCode) => {
      const { client, transport } = setup();
      client.sendNotification.mockRejectedValue({ statusCode });
      await expect(
        transport.send(subscription, content),
      ).rejects.toBeInstanceOf(PermanentPushError);
    },
  );

  it('leaves a network outcome ambiguous', async () => {
    const { client, transport } = setup();
    client.sendNotification.mockRejectedValue(
      new Error('sensitive network detail'),
    );
    await expect(transport.send(subscription, content)).rejects.toThrow(
      'PUSH_ACK_UNKNOWN',
    );
    client.sendNotification.mockRejectedValue({ statusCode: 0 });
    await expect(transport.send(subscription, content)).rejects.toThrow(
      'PUSH_ACK_UNKNOWN',
    );
  });

  it('fails closed without configuration or with mismatched keys', async () => {
    const { client, transport } = setup(false);
    expect(transport.isAvailable()).toBe(false);
    await expect(transport.send(subscription, content)).rejects.toBeInstanceOf(
      PermanentPushError,
    );
    expect(client.sendNotification).not.toHaveBeenCalled();
    expect(parseVapidConfiguration({})).toBeNull();
    expect(
      parseVapidConfiguration({
        VAPID_SUBJECT: 'mailto:ops@example.invalid',
        VAPID_PUBLIC_KEY: 'invalid',
        VAPID_PRIVATE_KEY: 'invalid',
      }),
    ).toBeNull();

    // This pair exists only in memory for validation; no key is written or logged.
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.alloc(32, 1));
    const env = {
      VAPID_SUBJECT: 'mailto:ops@example.invalid',
      VAPID_PUBLIC_KEY: ecdh.getPublicKey('base64url', 'uncompressed'),
      VAPID_PRIVATE_KEY: Buffer.alloc(32, 1).toString('base64url'),
    };
    expect(parseVapidConfiguration(env)).toEqual({
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
    expect(
      parseVapidConfiguration({ ...env, VAPID_PUBLIC_KEY: 'invalid' }),
    ).toBeNull();
    expect(
      parseVapidConfiguration({
        ...env,
        VAPID_SUBJECT: 'https://localhost/contact',
      }),
    ).toBeNull();

    vi.stubEnv('VAPID_SUBJECT', env.VAPID_SUBJECT);
    vi.stubEnv('VAPID_PUBLIC_KEY', env.VAPID_PUBLIC_KEY);
    vi.stubEnv('VAPID_PRIVATE_KEY', env.VAPID_PRIVATE_KEY);
    expect(new WebPushConfiguration().publicState()).toEqual({
      available: true,
      publicKey: env.VAPID_PUBLIC_KEY,
    });
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    expect(new WebPushConfiguration().publicState()).toEqual({
      available: false,
      publicKey: null,
      reason: 'WEB_PUSH_UNAVAILABLE',
    });
    vi.unstubAllEnvs();
  });
});
