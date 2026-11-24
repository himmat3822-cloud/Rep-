// Ready-made workout + diet plans that ship with Rep+. A trainer picks one
// in the plan editor, adjusts it for the member, and saves. Plain data, safe
// for client components. Every plan passes templateSchema (tests check it).
//
// Diet notes are general habits with Indian home food, not medical advice:
// no calorie targets, no supplements, no crash diets.

import type { DietMeal } from './diet'

export interface ReadyExercise {
  name: string
  sets: number
  reps: string
}

export interface ReadyDay {
  weekday: number // 0 Sun ... 6 Sat
  title: string
  focus: string
  minutes: number
  exercises: ReadyExercise[]
}

export interface ReadyPlan {
  key: string
  name: string
  goal: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  // One line telling the trainer who this suits.
  forWho: string
  days: ReadyDay[]
  dietMeals: DietMeal[]
  dietNotes: string
}

type Ex = [string, number, string]
const d = (weekday: number, title: string, focus: string, minutes: number, list: Ex[]): ReadyDay => ({
  weekday,
  title,
  focus,
  minutes,
  exercises: list.map(([name, sets, reps]) => ({ name, sets, reps })),
})

type Meal = [string, string, string]
const meals = (list: Meal[]): DietMeal[] => list.map(([name, time, items]) => ({ name, time, items }))

const VEG_LOSS = {
  meals: meals([
    ['Meal 1', '8 AM', 'Besan chilla (2) or poha with peanuts, 1 bowl curd'],
    ['Meal 2', '11 AM', '1 fruit (apple, guava or papaya) with a handful of roasted chana'],
    ['Meal 3', '1:30 PM', '2 rotis, big bowl dal, sabzi, salad. Half the plate vegetables'],
    ['Meal 4', '5 PM', 'Sprouts chaat or buttermilk, green tea'],
    ['Meal 5', '8:30 PM', 'Paneer or tofu bhurji with sabzi, 1 roti or none'],
  ]),
  notes: '3 litres of water, 8,000+ steps a day. Sweets, fried snacks and cold drinks only on weekends.',
}

const NONVEG_LOSS = {
  meals: meals([
    ['Meal 1', '8 AM', '3 egg omelette (2 whole + 1 white), 1 multigrain toast or a bowl of oats'],
    ['Meal 2', '11 AM', '1 fruit with a handful of roasted chana'],
    ['Meal 3', '1:30 PM', '2 rotis, chicken curry (less oil) or dal, sabzi, salad'],
    ['Meal 4', '5 PM', 'Buttermilk or 2 boiled eggs'],
    ['Meal 5', '8:30 PM', 'Grilled chicken, fish or egg bhurji with stir-fried vegetables'],
  ]),
  notes: '3 litres of water, 8,000+ steps a day. Keep rice to one small bowl a day.',
}

const GAIN = {
  meals: meals([
    ['Meal 1', '8 AM', '2 paneer or aloo parathas with curd, or 4 eggs with toast, 1 glass milk'],
    ['Meal 2', '11 AM', 'Banana shake or peanut chikki with a fruit'],
    ['Meal 3', '1:30 PM', '3 rotis or rice, dal, rajma or chole, sabzi, curd'],
    ['Meal 4', 'After workout', 'Banana with peanut butter roti, or milk with dates'],
    ['Meal 5', '8:30 PM', 'Paneer, soya chunks, chicken or eggs with rice or rotis'],
  ]),
  notes: 'Eat 5 times a day, never skip breakfast. Protein in every meal. Sleep 7 to 8 hours.',
}

const BEGINNER = {
  meals: meals([
    ['Meal 1', '8 AM', 'Poha, upma or 2 eggs with toast, plus curd or milk'],
    ['Meal 2', '1:30 PM', '2 to 3 rotis, dal, sabzi, salad, curd'],
    ['Meal 3', '5 PM', '1 fruit and a handful of nuts or roasted chana'],
    ['Meal 4', '8:30 PM', 'Light dinner: dal or paneer or chicken with sabzi and 1 to 2 rotis'],
  ]),
  notes: 'Protein with every meal. 3 litres of water. Tea at most 2 cups, less sugar. Sweets and fried food only on weekends.',
}

const STRENGTH = {
  meals: meals([
    ['Meal 1', '8 AM', 'Oats with milk and banana, or 3 to 4 eggs with toast'],
    ['Meal 2', '1:30 PM', '3 rotis or rice, dal, sabzi, paneer or chicken, curd'],
    ['Meal 3', 'Before workout', 'Banana and a handful of peanuts, or poha'],
    ['Meal 4', 'After workout', 'Milk, paneer, eggs or chicken with rice or rotis'],
  ]),
  notes: 'Do not train heavy on an empty stomach. 3 litres of water. Sleep 7 to 8 hours, recovery is where strength grows.',
}

const FIT_40 = {
  meals: meals([
    ['Meal 1', '8 AM', 'Vegetable daliya or oats, or 2 eggs with toast'],
    ['Meal 2', '11 AM', '1 fruit and a few almonds or walnuts'],
    ['Meal 3', '1:30 PM', '2 rotis (multigrain), dal, sabzi, salad, curd'],
    ['Meal 4', '5 PM', 'Buttermilk or green tea with roasted chana'],
    ['Meal 5', '8 PM', 'Light dinner: soup, sabzi and dal or fish, 1 roti'],
  ]),
  notes: 'Less salt and fried food, more fibre. Walk 15 minutes after dinner. Members with BP, sugar or joint issues should follow their doctor\'s advice first.',
}

export const READY_PLANS: ReadyPlan[] = [
  {
    key: 'beginner-full-body-3',
    name: 'Beginner full body (3 days)',
    goal: 'New members, first 8 weeks',
    level: 'Beginner',
    forWho: 'Anyone new to the gym or back after a long break.',
    days: [
      d(1, 'Full body A', 'Legs, chest, back', 50, [['Goblet squat', 3, '12'], ['Machine chest press', 3, '12'], ['Lat pulldown', 3, '12'], ['Leg curl machine', 2, '12'], ['Plank', 3, '30s']]),
      d(3, 'Full body B', 'Hips, shoulders, back', 50, [['Leg press', 3, '12'], ['Dumbbell shoulder press', 3, '10'], ['Seated cable row', 3, '12'], ['Glute bridge', 3, '15'], ['Dead bug', 3, '10 each side']]),
      d(5, 'Full body C', 'Full body + cardio', 50, [['Walking lunges', 2, '10 each leg'], ['Incline push-ups', 3, '10'], ['Dumbbell row', 3, '10 each arm'], ['Cycling', 1, '10 min'], ['Side plank', 2, '20s each side']]),
    ],
    dietMeals: BEGINNER.meals,
    dietNotes: BEGINNER.notes,
  },
  {
    key: 'fat-loss-veg-4',
    name: 'Fat loss, vegetarian (4 days)',
    goal: 'Lose fat, keep strength',
    level: 'Beginner',
    forWho: 'Vegetarian members who want to lose weight.',
    days: [
      d(1, 'Upper body', 'Chest, back, shoulders', 55, [['Dumbbell bench press', 3, '12'], ['Lat pulldown', 3, '12'], ['Dumbbell shoulder press', 3, '12'], ['Seated cable row', 3, '12'], ['Treadmill incline walk', 1, '15 min']]),
      d(2, 'Lower body', 'Legs, glutes, core', 55, [['Goblet squat', 3, '15'], ['Romanian deadlift (dumbbell)', 3, '12'], ['Step-ups', 3, '12 each leg'], ['Leg extension', 2, '15'], ['Plank', 3, '40s']]),
      d(4, 'Circuit', 'Full body, heart rate up', 45, [['Kettlebell swing', 4, '15'], ['Push-ups', 4, '10'], ['Box squat jumps or squats', 4, '12'], ['Mountain climbers', 4, '30s'], ['Rowing machine', 1, '10 min']]),
      d(5, 'Cardio + core', 'Conditioning', 45, [['Cycling intervals', 1, '20 min'], ['Hanging knee raise', 3, '12'], ['Russian twist', 3, '20'], ['Side plank', 3, '30s each side']]),
    ],
    dietMeals: VEG_LOSS.meals,
    dietNotes: VEG_LOSS.notes,
  },
  {
    key: 'fat-loss-nonveg-4',
    name: 'Fat loss, non-veg (4 days)',
    goal: 'Lose fat, keep strength',
    level: 'Beginner',
    forWho: 'Members who eat eggs or chicken and want to lose weight.',
    days: [
      d(1, 'Upper body', 'Chest, back, shoulders', 55, [['Dumbbell bench press', 3, '12'], ['Lat pulldown', 3, '12'], ['Dumbbell shoulder press', 3, '12'], ['Seated cable row', 3, '12'], ['Treadmill incline walk', 1, '15 min']]),
      d(2, 'Lower body', 'Legs, glutes, core', 55, [['Goblet squat', 3, '15'], ['Romanian deadlift (dumbbell)', 3, '12'], ['Step-ups', 3, '12 each leg'], ['Leg extension', 2, '15'], ['Plank', 3, '40s']]),
      d(4, 'Circuit', 'Full body, heart rate up', 45, [['Kettlebell swing', 4, '15'], ['Push-ups', 4, '10'], ['Squats', 4, '12'], ['Mountain climbers', 4, '30s'], ['Rowing machine', 1, '10 min']]),
      d(5, 'Cardio + core', 'Conditioning', 45, [['Cycling intervals', 1, '20 min'], ['Hanging knee raise', 3, '12'], ['Russian twist', 3, '20'], ['Side plank', 3, '30s each side']]),
    ],
    dietMeals: NONVEG_LOSS.meals,
    dietNotes: NONVEG_LOSS.notes,
  },
  {
    key: 'muscle-gain-upper-lower-4',
    name: 'Muscle gain, upper / lower (4 days)',
    goal: 'Build size, intermediate',
    level: 'Intermediate',
    forWho: 'Members training 3+ months who want to put on muscle.',
    days: [
      d(1, 'Upper (strength)', 'Chest, back', 65, [['Barbell bench press', 4, '6-8'], ['Barbell row', 4, '8'], ['Overhead press', 3, '8'], ['Pull-ups or assisted', 3, '8'], ['Barbell curl', 3, '10']]),
      d(2, 'Lower (strength)', 'Quads, hamstrings', 65, [['Back squat', 4, '6-8'], ['Romanian deadlift', 3, '8'], ['Leg press', 3, '10'], ['Standing calf raise', 4, '12']]),
      d(4, 'Upper (volume)', 'Shoulders, arms', 60, [['Incline dumbbell press', 4, '10'], ['Lat pulldown', 4, '10'], ['Lateral raise', 4, '15'], ['Cable fly', 3, '12'], ['Triceps pushdown', 3, '12'], ['Hammer curl', 3, '12']]),
      d(5, 'Lower (volume)', 'Legs, glutes', 60, [['Front squat or hack squat', 3, '10'], ['Walking lunges', 3, '12 each leg'], ['Leg curl', 3, '12'], ['Hip thrust', 3, '12'], ['Seated calf raise', 3, '15']]),
    ],
    dietMeals: GAIN.meals,
    dietNotes: GAIN.notes,
  },
  {
    key: 'ppl-6',
    name: 'Push / pull / legs (6 days)',
    goal: 'Muscle gain, advanced',
    level: 'Advanced',
    forWho: 'Regular members who can train 6 days and recover well.',
    days: [
      d(1, 'Push', 'Chest, shoulders, triceps', 65, [['Barbell bench press', 4, '6-8'], ['Overhead press', 3, '8'], ['Incline dumbbell press', 3, '10'], ['Lateral raise', 3, '15'], ['Triceps pushdown', 3, '12']]),
      d(2, 'Pull', 'Back, biceps', 65, [['Deadlift', 3, '5'], ['Pull-ups', 4, 'max'], ['Barbell row', 3, '8'], ['Face pull', 3, '15'], ['Barbell curl', 3, '10']]),
      d(3, 'Legs', 'Quads, hamstrings, calves', 65, [['Back squat', 4, '6-8'], ['Leg press', 3, '10'], ['Leg curl', 3, '12'], ['Standing calf raise', 4, '15']]),
      d(4, 'Push', 'Volume', 60, [['Incline bench press', 4, '8-10'], ['Dips', 3, '10'], ['Cable fly', 3, '12'], ['Arnold press', 3, '10'], ['Overhead triceps extension', 3, '12']]),
      d(5, 'Pull', 'Volume', 60, [['Lat pulldown', 4, '10'], ['Seated cable row', 3, '12'], ['Single arm dumbbell row', 3, '10'], ['Rear delt fly', 3, '15'], ['Hammer curl', 3, '12']]),
      d(6, 'Legs', 'Volume', 60, [['Front squat', 3, '8'], ['Romanian deadlift', 3, '10'], ['Walking lunges', 3, '12 each leg'], ['Leg extension', 3, '15'], ['Seated calf raise', 3, '15']]),
    ],
    dietMeals: GAIN.meals,
    dietNotes: GAIN.notes,
  },
  {
    key: 'women-tone-3',
    name: 'Toning and strength for women (3 days)',
    goal: 'Tone up, stronger glutes and core',
    level: 'Beginner',
    forWho: 'Women who want to tone up without heavy bulk (it will not happen).',
    days: [
      d(1, 'Lower body', 'Glutes, legs', 55, [['Hip thrust', 3, '12'], ['Goblet squat', 3, '12'], ['Romanian deadlift (dumbbell)', 3, '12'], ['Cable kickback', 3, '12 each leg'], ['Plank', 3, '30s']]),
      d(3, 'Upper body', 'Arms, back, shoulders', 50, [['Lat pulldown', 3, '12'], ['Dumbbell shoulder press', 3, '12'], ['Seated cable row', 3, '12'], ['Triceps pushdown', 3, '12'], ['Dumbbell curl', 3, '12']]),
      d(5, 'Full body + cardio', 'Glutes, core, stamina', 50, [['Walking lunges', 3, '10 each leg'], ['Step-ups', 3, '10 each leg'], ['Glute bridge', 3, '15'], ['Dead bug', 3, '10 each side'], ['Treadmill incline walk', 1, '15 min']]),
    ],
    dietMeals: VEG_LOSS.meals,
    dietNotes: VEG_LOSS.notes,
  },
  {
    key: 'strength-5x5-3',
    name: 'Strength basics 5x5 (3 days)',
    goal: 'Get stronger on the big lifts',
    level: 'Intermediate',
    forWho: 'Members who know the main lifts and want strength numbers to go up.',
    days: [
      d(1, 'Workout A', 'Squat, bench, row', 60, [['Back squat', 5, '5'], ['Barbell bench press', 5, '5'], ['Barbell row', 5, '5'], ['Plank', 3, '45s']]),
      d(3, 'Workout B', 'Squat, press, deadlift', 60, [['Back squat', 5, '5'], ['Overhead press', 5, '5'], ['Deadlift', 1, '5'], ['Hanging knee raise', 3, '10']]),
      d(5, 'Workout A', 'Squat, bench, row', 60, [['Back squat', 5, '5'], ['Barbell bench press', 5, '5'], ['Barbell row', 5, '5'], ['Farmer walk', 3, '30 m']]),
    ],
    dietMeals: STRENGTH.meals,
    dietNotes: STRENGTH.notes,
  },
  {
    key: 'fit-40-plus-3',
    name: 'Fit after 40, joint friendly (3 days)',
    goal: 'Strength, balance and stamina',
    level: 'Beginner',
    forWho: 'Members 40+ or with stiff knees and back. Machines, no jumping.',
    days: [
      d(1, 'Strength A', 'Legs, chest, back', 45, [['Leg press (light)', 3, '12'], ['Machine chest press', 3, '12'], ['Seated cable row', 3, '12'], ['Bird dog', 3, '8 each side'], ['Cycling', 1, '10 min']]),
      d(3, 'Strength B', 'Hips, shoulders, core', 45, [['Box squat to bench', 3, '10'], ['Lat pulldown', 3, '12'], ['Glute bridge', 3, '12'], ['Wall push-ups', 3, '12'], ['Side plank (knees)', 2, '20s each side']]),
      d(5, 'Mobility + walk', 'Balance and stamina', 40, [['Treadmill walk', 1, '20 min'], ['Single leg balance', 3, '30s each leg'], ['Cat-cow stretch', 2, '10'], ['Hip flexor stretch', 2, '30s each side']]),
    ],
    dietMeals: FIT_40.meals,
    dietNotes: FIT_40.notes,
  },
]
