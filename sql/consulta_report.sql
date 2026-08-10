-- Interacoes do periodo: uma linha por conversa, com a ultima tag valida
-- e se houve resposta do cliente.
SELECT
    sub.conversation_id,
    MAX(sub.telefone) AS telefone,
    CASE
        WHEN COUNT(*) FILTER (WHERE sub."totalTokens" IS NOT NULL) > 0 THEN 'SIM'
        ELSE 'NAO'
    END AS houve_interacao,
    (array_agg(sub.template_name ORDER BY sub."createdAt") FILTER (WHERE sub.template_name IS NOT NULL))[1] AS template_name,
    (array_agg(sub.campaign_alias ORDER BY sub."createdAt") FILTER (WHERE sub.campaign_alias IS NOT NULL))[1] AS campaign_alias,
    COALESCE(
        (array_agg(sub.tag_timestamp ORDER BY sub.tag_timestamp DESC NULLS LAST) FILTER (WHERE sub.tag_nome IS NOT NULL AND sub.tag_nome <> 'start_agent_execution'))[1],
        (array_agg(sub.tag_timestamp ORDER BY sub.tag_timestamp DESC NULLS LAST) FILTER (WHERE sub.tag_nome = 'start_agent_execution'))[1]
    ) AS ultimo_timestamp_valido,
    COALESCE(
        (array_agg(sub.tag_nome ORDER BY sub.tag_timestamp DESC NULLS LAST) FILTER (WHERE sub.tag_nome IS NOT NULL AND sub.tag_nome <> 'start_agent_execution'))[1],
        (array_agg(sub.tag_nome ORDER BY sub.tag_timestamp DESC NULLS LAST) FILTER (WHERE sub.tag_nome = 'start_agent_execution'))[1]
    ) AS ultima_tag_valida,
    BOOL_OR(sub.opcao_pagamento) AS opcao_pagamento,
    (array_agg(sub.tag_opcao_pagamento) FILTER (WHERE sub.tag_opcao_pagamento IS NOT NULL))[1] AS tag_opcao_pagamento
FROM (
    SELECT
        ml."conversationId" AS conversation_id,
        COALESCE(ml.metadata->>'phone_number', ml."phoneNumber") AS telefone,
        ml."totalTokens",
        ml."createdAt",
        ml.metadata->'broker'->'outbound'->'template'->>'name' AS template_name,
        ml.metadata->'broker'->'outbound'->>'campaign_alias' AS campaign_alias,
        CASE
            WHEN CAST(ml.metadata AS TEXT) NOT LIKE '%template_name%'
            THEN jsonb_path_query_array(ml.metadata, '$.tags[*].tag')::TEXT
            ELSE NULL
        END AS tags,
        tag_elem->>'tag' AS tag_nome,
        to_timestamp((tag_elem->>'timestamp')::double precision) AT TIME ZONE 'America/Sao_Paulo' AS tag_timestamp,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(ml.metadata->'tags', '[]'::jsonb)) AS tags
            WHERE tags->>'tag' LIKE 'tran_confirmar_opcao_pagamento%'
        ) AS opcao_pagamento,
        (
            SELECT tags->>'tag'
            FROM jsonb_array_elements(COALESCE(ml.metadata->'tags', '[]'::jsonb)) AS tags
            WHERE tags->>'tag' LIKE 'tran_confirmar_opcao_pagamento%'
            LIMIT 1
        ) AS tag_opcao_pagamento
    FROM public.message_logs ml
    LEFT JOIN LATERAL jsonb_array_elements(
        COALESCE(ml.metadata->'tags','[]'::jsonb)
    ) AS t(tag_elem) ON TRUE
    WHERE
        ml."createdAt"::date BETWEEN CAST(:data_inicio AS date) AND CAST(:data_fim AS date)
        AND ml."ownerId" = :owner_id
) sub
GROUP BY sub.conversation_id
ORDER BY sub.conversation_id;
