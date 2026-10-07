import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { storeJson } from '../fileModels/store.json'
import { jidFor, runInviteCommand } from './createInvite'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  username: Value.text({
    name: i18n('Username'),
    description: i18n(
      'The account to reset, as its username or its full address (user@domain).',
    ),
    required: true,
    default: null,
    placeholder: 'alice',
  }),
})

export const resetPassword = sdk.Action.withInput(
  'reset-password',

  async ({ effects }) => ({
    name: i18n('Reset Password'),
    description: i18n(
      'Create a single-use link that lets a user choose a new password for their account.',
    ),
    warning: null,
    allowedStatuses: 'only-running',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async () => ({}),

  async ({ effects, input }) => {
    const domain = (await storeJson.read((s) => s.domain).once()) ?? ''
    const link = await runInviteCommand([
      'prosodyctl',
      'shell',
      'invite',
      'create_reset',
      jidFor(input.username.trim(), domain),
    ])
    return {
      version: '1',
      title: i18n('Password reset link'),
      message: i18n(
        'Give this link to the user. Opening it lets them set a new password; it can be used once.',
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
