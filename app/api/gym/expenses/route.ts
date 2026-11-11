import { gymRoute, ok } from '@/lib/api/guard'
import { expenseSchema } from '@/lib/validation/growth'
import { createExpense } from '@/lib/owner/engagement'

// POST /api/gym/expenses - rent, salaries, electricity... for the profit view
export const POST = gymRoute({ permission: 'expenses.manage', feature: 'expenses_profit', schema: expenseSchema }, async ({ db, gym, input, staff }) => {
  const row = await createExpense(db, gym.id, staff!.sub, input)
  return ok({ id: row.id }, { status: 201 })
})
