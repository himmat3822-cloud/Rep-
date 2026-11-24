// Diet plan as meals: "Meal 1 - 8 AM - 2 besan chilla, curd". Plain data,
// safe for client components.

export interface DietMeal {
  name: string
  time: string
  items: string
}

export const MAX_MEALS = 8

// Reads stored JSON safely (old rows have [] or nothing).
export function parseMeals(value: unknown): DietMeal[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((meal): meal is Record<string, unknown> => Boolean(meal) && typeof meal === 'object')
    .map((meal) => ({
      name: typeof meal.name === 'string' ? meal.name : '',
      time: typeof meal.time === 'string' ? meal.time : '',
      items: typeof meal.items === 'string' ? meal.items : '',
    }))
    .filter((meal) => meal.items.trim())
    .slice(0, MAX_MEALS)
}

export function blankMeals(count: number): DietMeal[] {
  return Array.from({ length: count }, (_, index) => ({ name: `Meal ${index + 1}`, time: '', items: '' }))
}

// Starting times a trainer can tap; always editable.
export const MEAL_TIME_HINTS = ['7 AM', '10 AM', '1 PM', '4 PM', '6 PM', '8 PM', '9 PM']
