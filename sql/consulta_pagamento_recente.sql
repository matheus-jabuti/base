-- Telefones que confirmaram opcao de pagamento entre data_inicio e data_fim,
-- independente do periodo do relatorio. Usado pra nao redisparar pra quem
-- acabou de pagar e o pagamento ainda nao foi compensado.
SELECT DISTINCT
    COALESCE(ml.metadata->>'phone_number', ml."phoneNumber") AS telefone
FROM public.message_logs ml
WHERE
    ml."ownerId" = :owner_id
    AND ml."createdAt"::date BETWEEN CAST(:data_inicio AS date) AND CAST(:data_fim AS date)
    AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(ml.metadata->'tags', '[]'::jsonb)) AS tags
        WHERE tags->>'tag' LIKE 'tran_confirmar_opcao_pagamento%'
    );
