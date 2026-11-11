-- Health app sync is postponed: take it out of every Kasrat plan and every
-- per-gym grant so no gym pays for it. The HealthMetric table stays for later.
UPDATE "PlatformPlan" SET "features" = array_remove("features", 'health_sync') WHERE 'health_sync' = ANY("features");
UPDATE "GymOverride" SET "extraFeatures" = array_remove("extraFeatures", 'health_sync') WHERE 'health_sync' = ANY("extraFeatures");
UPDATE "GymOverride" SET "removedFeatures" = array_remove("removedFeatures", 'health_sync') WHERE 'health_sync' = ANY("removedFeatures");
