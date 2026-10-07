import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { runtime } from '../runtime'
import { sdk } from '../sdk'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  admin: Value.toggle({
    name: i18n('Administrator'),
    description: i18n(
      'The account created from this invite can manage users and settings. Use it for your own first account.',
    ),
    default: false,
  }),
})

/**
 * Run an invite command inside the running server container and return the
 * link it prints. `create-invite` is upstream's script; a password reset
 * goes straight to `prosodyctl shell`, because upstream's `--reset` wrapper
 * keeps only the confirmation line and drops the link.
 */
export async function runInviteCommand(command: string[]): Promise<string> {
  const subs = runtime.get()
  const domain = await storeJson.read((s) => s.domain).once()
  if (!subs || !domain) {
    throw new Error(
      i18n(
        'Snikket must be running to create invites. Start it and try again.',
      ),
    )
  }
  const res = await subs.server.exec(command, {
    env: { SNIKKET_DOMAIN: domain },
  })
  const out = String(res.stdout)
  const link = out.match(/https?:\/\/\S+/)?.[0]
  if (res.exitCode !== 0 || !link) {
    throw new Error(
      i18n('Snikket could not create the invite: ${error}', {
        error: (String(res.stderr) || out).trim().slice(-500),
      }),
    )
  }
  return link
}

export function jidFor(user: string, domain: string): string {
  return user.includes('@') ? user : `${user}@${domain}`
}

export const createInvite = sdk.Action.withInput(
  'create-invite',

  async ({ effects }) => ({
    name: i18n('Create Invite'),
    description: i18n(
      'Create a single-use link that lets someone register an account on your server. Every account starts from an invite, your own included.',
    ),
    warning: null,
    allowedStatuses: 'only-running',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => ({ admin: false }),

  async ({ effects, input }) => {
    const link = await runInviteCommand([
      'create-invite',
      ...(input.admin ? ['--admin'] : []),
    ])
    return {
      version: '1',
      title: input.admin ? i18n('Admin invite') : i18n('Invite'),
      message: i18n(
        'Open this link on the device that will use the account, or scan the code with the Snikket app. It can be used once.',
      ),
      result: {
        type: 'single',
        value: link,
        copyable: true,
        qr: true,
        masked: false,
      },
    }
  },
)
