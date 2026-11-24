-- Diet split into meals (Meal 1, Meal 2 ...)
ALTER TABLE "WorkoutSplit" ADD COLUMN "dietMeals" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "WorkoutTemplate" ADD COLUMN "dietMeals" JSONB NOT NULL DEFAULT '[]';
