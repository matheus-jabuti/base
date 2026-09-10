-- Operacao B: base propria de disparo, lida direto do cadastro de clientes.
--
-- Diferente da Operacao A, aqui nao ha cruzamento com o banco de mensagens: a
-- consulta ja devolve a lista final de telefones da operacao. Os campos tambem
-- tem nomes proprios (des_cpf, segmentacao, prioridade) em vez dos usados na A.
--
-- O nome nao vinha nesta consulta e a planilha de disparo precisa dele (coluna
-- name). Sai por COALESCE porque os registros da operacao B nao seguem sempre a
-- mesma chave do cadastro da A (nom_clien); quem vier sem nome em nenhuma das
-- chaves e tratado como "Cliente" na geracao.
SELECT DISTINCT ON (attributes->'campos'->>'phone_number')
    attributes->'campos'->>'phone_number' AS telefone,
    COALESCE(
        attributes->'campos'->>'nom_clien',
        attributes->'campos'->>'nome'
    )                                     AS nome,
    attributes->'campos'->>'des_cpf'      AS cpf,
    attributes->'campos'->>'segmentacao'  AS bucket,
    attributes->'campos'->>'prioridade'   AS rating
FROM public.customer
WHERE attributes->'campos'->>'operacao' = 'B'
ORDER BY
    attributes->'campos'->>'phone_number';
