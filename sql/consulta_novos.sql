-- Clientes cadastrados/atualizados no periodo, que ainda nao entraram em
-- nenhuma campanha.
WITH dados AS (
    SELECT
        attributes->'campos'->>'des_regis' AS cpf,
        attributes->'campos'->>'nom_clien' AS nome,
        attributes->>'phone_number' AS celular_original,
        attributes->'campos'->>'val_princ' AS valor_princ,
        attributes->'campos'->>'Cod_tipo' AS tipo_telefone,
        attributes->'campos'->>'dat_venci' AS dat_venci,
        attributes->'campos'->'cod_indicador'->>'RAT_AMIG' AS rating,
        attributes->'campos'->>'ind_baixa' AS ind_baixa,
        CASE
            WHEN attributes->'campos'->>'cod_credor' IN ('2', '7') THEN 'amigavel'
            ELSE 'contencioso'
        END AS tipo,
        created_at,
        ARRAY[
            attributes->>'phone_number',
            attributes->'campos'->>'des_fones_refer',
            attributes->'campos'->>'des_fones_resid',
            attributes->'campos'->>'des_fones_comer',
            attributes->'campos'->>'des_fones1',
            attributes->'campos'->>'des_fones2',
            attributes->'campos'->>'num_telefone'
        ] AS telefones
    FROM public.customer
    WHERE updated_at::date BETWEEN CAST(:data_inicio AS date) AND CAST(:data_fim AS date)
      AND attributes->>'phone_number' IS NOT NULL
      AND attributes->'campos'->>'nom_clien' IS NOT NULL
),
telefones_unicos AS (
    SELECT
        d.*,
        ARRAY(
            SELECT telefone
            FROM (
                SELECT DISTINCT ON (telefone)
                    telefone,
                    ord
                FROM unnest(d.telefones) WITH ORDINALITY AS t(telefone, ord)
                WHERE telefone IS NOT NULL
                  AND trim(telefone) <> ''
                ORDER BY telefone, ord
            ) x
            ORDER BY ord
        ) AS telefones_limpos
    FROM dados d
)
SELECT
    cpf,
    nome,
    telefones_limpos[1] AS telefone,
    telefones_limpos[2] AS telefone_2,
    telefones_limpos[3] AS telefone_3,
    valor_princ,
    tipo_telefone,
    tipo,
    ind_baixa,
    dat_venci::date AS data_vencimento,
    current_date - dat_venci::date AS dias_atraso,
    CASE
        WHEN tipo = 'amigavel' AND current_date - dat_venci::date BETWEEN 1 AND 5 THEN 'pre-cobranca'
        WHEN tipo = 'amigavel' AND current_date - dat_venci::date BETWEEN 6 AND 30 THEN 'Bucket 01'
        WHEN tipo = 'amigavel' AND current_date - dat_venci::date BETWEEN 31 AND 60 THEN 'Bucket 02'
        WHEN tipo = 'amigavel' AND current_date - dat_venci::date BETWEEN 61 AND 97 THEN 'Bucket 03'
        WHEN tipo = 'amigavel' AND current_date - dat_venci::date >= 97 THEN 'Acima de 97'
        WHEN tipo = 'contencioso' AND current_date - dat_venci::date < 100 THEN 'Cont. Abaixo de 100'
        WHEN tipo = 'contencioso' AND current_date - dat_venci::date <= 180 THEN '100 a 180'
        WHEN tipo = 'contencioso' AND current_date - dat_venci::date BETWEEN 181 AND 360 THEN '180 a 360'
        WHEN tipo = 'contencioso' AND current_date - dat_venci::date BETWEEN 361 AND 540 THEN '360 a 540'
        WHEN tipo = 'contencioso' AND current_date - dat_venci::date > 540 THEN 'Acima 540'
        ELSE 'Fora da regra'
    END AS bucket,
    rating,
    created_at
FROM telefones_unicos;
