-- =============================================================================
-- Totem — Seed de desarrollo (OPCIONAL)
-- =============================================================================
-- Datos mínimos para desarrollo y testing: una organización de prueba, un
-- usuario admin y dos unidades (sim-001, sim-002) con sus totem_configs.
--
-- NO forma parte de las migraciones Alembic — el esquema lo crean las
-- migraciones al arrancar el contenedor api (ver docs/capa2/migraciones-alembic.md).
-- Aplicar manualmente después de que el api haya arrancado al menos una vez:
--
--   docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB < db/seed.dev.sql
-- =============================================================================

DO $$
DECLARE
    v_org_id    UUID := '00000000-0000-0000-0000-000000000001';
    v_user_id   UUID := '00000000-0000-0000-0000-000000000010';
    v_unit1_id  UUID := '00000000-0000-0000-0000-000000000100';
    v_unit2_id  UUID := '00000000-0000-0000-0000-000000000101';
BEGIN

    -- Organización de prueba
    INSERT INTO organizations (id, name, created_at)
    VALUES (v_org_id, 'Organización de Prueba', NOW());

    -- Usuario admin de prueba
    -- IMPORTANTE: password_hash corresponde a la contraseña 'changeme'.
    -- Reemplazar con un hash real (bcrypt o argon2) antes de usar en producción.
    INSERT INTO users (id, email, password_hash, created_at)
    VALUES (
        v_user_id,
        'admin@totem.local',
        '$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH_changeme_placeholder_xxxxx',
        NOW()
    );

    -- Membresía: usuario admin en la organización de prueba
    INSERT INTO memberships (user_id, organization_id, role, joined_at)
    VALUES (v_user_id, v_org_id, 'admin', NOW());

    -- Unidad sim-001 (simulador totem principal)
    INSERT INTO units (id, organization_id, type, name, api_key, is_active, created_at)
    VALUES (
        v_unit1_id,
        v_org_id,
        'totem',
        'Simulador Totem 001',
        'sim-001-api-key-dev-only-replace-in-production',
        true,
        NOW()
    );

    -- Unidad sim-002 (segundo simulador totem)
    INSERT INTO units (id, organization_id, type, name, api_key, is_active, created_at)
    VALUES (
        v_unit2_id,
        v_org_id,
        'totem',
        'Simulador Totem 002',
        'sim-002-api-key-dev-only-replace-in-production',
        true,
        NOW()
    );

    -- totem_configs para ambas unidades (sin perfil activo asignado aún)
    INSERT INTO totem_configs (unit_id, active_profile_id)
    VALUES (v_unit1_id, NULL);

    INSERT INTO totem_configs (unit_id, active_profile_id)
    VALUES (v_unit2_id, NULL);

END $$;
