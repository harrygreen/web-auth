import { conform, useForm } from '@conform-to/react'
import { getFieldsetConstraint, parse } from '@conform-to/zod'
import {
	json,
	redirect,
	type DataFunctionArgs,
	type V2_MetaFunction,
} from '@remix-run/node'
import { Form, Link, useActionData, useLoaderData } from '@remix-run/react'
import { FormStrategy } from 'remix-auth-form'
import { safeRedirect } from 'remix-utils'
import { z } from 'zod'
import { GeneralErrorBoundary } from '~/components/error-boundary.tsx'
import { CheckboxField, ErrorList, Field } from '~/components/forms.tsx'
import { Spacer } from '~/components/spacer.tsx'
import { StatusButton } from '~/components/ui/status-button.tsx'
import { authenticator, requireAnonymous } from '~/utils/auth.server.ts'
import { prisma } from '~/utils/db.server.ts'
import { useIsSubmitting } from '~/utils/misc.tsx'
import { commitSession, getSession } from '~/utils/session.server.ts'
import { passwordSchema, usernameSchema } from '~/utils/user-validation.ts'
import { checkboxSchema } from '~/utils/zod-extensions.ts'

const LoginFormSchema = z.object({
	username: usernameSchema,
	password: passwordSchema,
	redirectTo: z.string().optional(),
	remember: checkboxSchema(),
})

export async function loader(args: DataFunctionArgs) {
	const { request } = args
	await requireAnonymous(request)
	const session = await getSession(request.headers.get('cookie'))
	const error = session.get(authenticator.sessionErrorKey)
	let errorMessage: string | null = null
	if (typeof error?.message === 'string') {
		errorMessage = error.message
	}
	return json(
		{ formError: errorMessage },
		{ headers: { 'Set-Cookie': await commitSession(session) } },
	)
}

export async function action({ request }: DataFunctionArgs) {
	const formData = await request.formData()
	const cookieSession = await getSession(request.headers.get('cookie'))
	const submission = await parse(formData, {
		schema: intent =>
			LoginFormSchema.transform(async (data, ctx) => {
				if (intent !== 'submit') return { ...data, session: null }

				try {
					const sessionId = await authenticator.authenticate(
						FormStrategy.name,
						request,
						{
							throwOnError: true,
							context: { formData },
						},
					)
					const session = await prisma.session.findUniqueOrThrow({
						where: { id: sessionId },
						select: { userId: true, id: true, expirationDate: true },
					})
					return { ...data, session }
				} catch (error) {
					if (error instanceof Error) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: error.message,
						})

						return z.NEVER
					}

					throw error
				}
			}),
		async: true,
	})
	// get the password off the payload that's sent back
	delete submission.payload.password

	if (submission.intent !== 'submit') {
		// @ts-expect-error - conform should probably have support for doing this
		delete submission.value?.password
		return json({ status: 'idle', submission } as const)
	}
	if (!submission.value || !submission.value.session) {
		return json({ status: 'error', submission } as const, { status: 400 })
	}

	const { remember, redirectTo, session } = submission.value

	cookieSession.set(authenticator.sessionKey, session.id)

	return redirect(safeRedirect(redirectTo), {
		headers: {
			'Set-Cookie': await commitSession(cookieSession, {
				// Cookies with no expiration are cleared when the tab/window closes
				expires: remember ? session.expirationDate : undefined,
			}),
		},
	})
}

export default function LoginPage() {
	const data = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const isSubmitting = useIsSubmitting()

	const [form, fields] = useForm({
		id: 'login-form',
		constraint: getFieldsetConstraint(LoginFormSchema),
		lastSubmission: actionData?.submission,
		onValidate({ formData }) {
			return parse(formData, { schema: LoginFormSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<div className="flex min-h-full flex-col justify-center pb-32 pt-20">
			<div className="mx-auto w-full max-w-md">
				<div className="flex flex-col gap-3 text-center">
					<h1 className="text-h1">Welcome back!</h1>
					<p className="text-body-md text-muted-foreground">
						Please enter your details.
					</p>
				</div>
				<Spacer size="xs" />

				<div>
					<div className="mx-auto w-full max-w-md px-8">
						<Form method="POST" {...form.props}>
							<input type="hidden" name="form" value={form.id} />
							<Field
								labelProps={{ children: 'Username' }}
								inputProps={{
									...conform.input(fields.username),
									autoFocus: true,
									className: 'lowercase',
								}}
								errors={fields.username.errors}
							/>

							<Field
								labelProps={{ children: 'Password' }}
								inputProps={conform.input(fields.password, {
									type: 'password',
								})}
								errors={fields.password.errors}
							/>

							<div className="flex justify-between">
								<CheckboxField
									labelProps={{
										htmlFor: fields.remember.id,
										children: 'Remember me',
									}}
									buttonProps={conform.input(fields.remember, {
										type: 'checkbox',
									})}
									errors={fields.remember.errors}
								/>

								<div>
									<Link
										to="/forgot-password"
										className="text-body-xs font-semibold"
									>
										Forgot password?
									</Link>
								</div>
							</div>

							<input {...conform.input(fields.redirectTo)} type="hidden" />
							<ErrorList
								errors={[...form.errors, data.formError]}
								id={form.errorId}
							/>

							<div className="flex items-center justify-between gap-6 pt-3">
								<StatusButton
									className="w-full"
									status={
										isSubmitting ? 'pending' : actionData?.status ?? 'idle'
									}
									type="submit"
									disabled={isSubmitting}
								>
									Log in
								</StatusButton>
							</div>
						</Form>
						<div className="flex items-center justify-center gap-2 pt-6">
							<span className="text-muted-foreground">New here?</span>
							<Link to="/signup">Create an account</Link>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

export const meta: V2_MetaFunction = () => {
	return [{ title: 'Login to Epic Notes' }]
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}