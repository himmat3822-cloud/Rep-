import { gymRoute, ok } from '@/lib/api/guard'
import { deleteExpense } from '@/lib/owner/engagement'

// DELETE /api/gym/expenses/{id}
export const DELETE = gymRoute({ permission: 'expenses.manage', feature: 'expenses_profit' }, async ({ db, params }) => ok(await deleteExpense(db, params.id)))
