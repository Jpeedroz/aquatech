-- ============================================================
-- AQUATECH - BANCO DE DADOS (PostgreSQL 11 ou superior)
-- ============================================================
--
-- Versão ajustada às necessidades do front-end (telas de Login,
-- Cadastro, Dashboard, Histórico, Irrigações, Consumo,
-- Configurações e Recuperação de senha).
--
-- Observação sobre fuso horário: as colunas TIMESTAMP não guardam
-- fuso. Recomenda-se que o Flask abra cada conexão com:
--     SET TIME ZONE 'America/Fortaleza';
--
-- ============================================================


-- ============================================================
-- 1. LIMPEZA
-- ============================================================

DROP VIEW IF EXISTS resumo_dashboard;
DROP VIEW IF EXISTS consumo_diario;

DROP TABLE IF EXISTS solicitacoes_troca_email CASCADE;
DROP TABLE IF EXISTS tokens_recuperacao_senha CASCADE;
DROP TABLE IF EXISTS leituras_sensores CASCADE;
DROP TABLE IF EXISTS sensores CASCADE;
DROP TABLE IF EXISTS eventos_irrigacao CASCADE;
DROP TABLE IF EXISTS dispositivos CASCADE;
DROP TABLE IF EXISTS propriedades CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

DROP FUNCTION IF EXISTS atualizar_timestamp() CASCADE;


-- ============================================================
-- 2. FUNÇÃO AUXILIAR: atualizar "atualizado_em" automaticamente
-- ============================================================

CREATE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 3. USUÁRIOS
-- ============================================================
--
-- telefone:
--   usado no cadastro e em Configurações > Minha conta.
--
-- senha_alterada_em:
--   data da última troca de senha. O Flask recusa sessões/tokens
--   emitidos ANTES desta data (invalida sessões antigas).
--
-- O hash da senha é gerado pelo Flask. A senha nunca é guardada.
--
-- ============================================================

CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,

    nome VARCHAR(100) NOT NULL,

    email VARCHAR(150) NOT NULL,

    telefone VARCHAR(20),

    senha_hash TEXT NOT NULL,

    senha_alterada_em TIMESTAMP,

    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- E-mail único sem diferenciar maiúsculas de minúsculas
-- (Joao@x.com e joao@x.com são o mesmo e-mail).
CREATE UNIQUE INDEX ux_usuarios_email
ON usuarios (LOWER(email));

CREATE TRIGGER trg_usuarios_atualizado
BEFORE UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();


-- ============================================================
-- 4. PROPRIEDADE
-- ============================================================
--
-- Cada usuário possui UMA propriedade (o sistema trabalha com
-- usuario_id -> propriedade_id). O mesmo registro alimenta o
-- cadastro (etapa 2) e Configurações > Minha propriedade.
--
-- limite_umidade:
--   umidade (%) ABAIXO da qual a irrigação LIGA.
--
-- limite_umidade_desliga:
--   umidade (%) em que a irrigação DESLIGA.
--   Precisa ser maior que limite_umidade.
--
-- O Dashboard desenha as duas linhas ("Liga 18%" e "Desliga 30%").
--
-- metodo_irrigacao:
--   as duas opções oferecidas nas telas.
--
-- ============================================================

CREATE TABLE propriedades (
    id SERIAL PRIMARY KEY,

    usuario_id INTEGER NOT NULL UNIQUE
        REFERENCES usuarios(id)
        ON DELETE CASCADE,

    nome VARCHAR(100) NOT NULL,

    localizacao VARCHAR(150),

    area_hectares NUMERIC(10,2)
        CHECK (area_hectares > 0),

    cultura VARCHAR(100),

    metodo_irrigacao VARCHAR(50) NOT NULL
        DEFAULT 'Bomba d''água'
        CHECK (metodo_irrigacao IN ('Bomba d''água', 'Gravidade')),

    limite_umidade NUMERIC(5,2) NOT NULL
        DEFAULT 18.00
        CHECK (
            limite_umidade >= 0
            AND limite_umidade <= 100
        ),

    limite_umidade_desliga NUMERIC(5,2) NOT NULL
        DEFAULT 30.00
        CHECK (
            limite_umidade_desliga >= 0
            AND limite_umidade_desliga <= 100
        ),

    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CHECK (limite_umidade_desliga > limite_umidade)
);

CREATE TRIGGER trg_propriedades_atualizado
BEFORE UPDATE ON propriedades
FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();


-- ============================================================
-- 5. ESP32 / DISPOSITIVO
-- ============================================================
--
-- online:
-- TRUE  = ESP32 conectado
-- FALSE = ESP32 desconectado
--
-- irrigacao_ligada:
-- TRUE  = irrigação ligada
-- FALSE = irrigação desligada
--
-- ============================================================

CREATE TABLE dispositivos (
    id SERIAL PRIMARY KEY,

    propriedade_id INTEGER NOT NULL
        REFERENCES propriedades(id)
        ON DELETE CASCADE,

    codigo_dispositivo VARCHAR(50) UNIQUE NOT NULL,

    nome VARCHAR(100) NOT NULL,

    online BOOLEAN NOT NULL DEFAULT FALSE,

    irrigacao_ligada BOOLEAN NOT NULL DEFAULT FALSE,

    ultimo_sinal TIMESTAMP,

    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 6. SENSORES
-- ============================================================

CREATE TABLE sensores (
    id SERIAL PRIMARY KEY,

    dispositivo_id INTEGER NOT NULL
        REFERENCES dispositivos(id)
        ON DELETE CASCADE,

    tipo VARCHAR(30) NOT NULL
        CHECK (
            tipo IN (
                'umidade_solo',
                'temperatura',
                'vazao_agua'
            )
        ),

    nome VARCHAR(100) NOT NULL,

    unidade VARCHAR(20) NOT NULL,

    UNIQUE(dispositivo_id, tipo)
);


-- ============================================================
-- 7. LEITURAS DOS SENSORES
-- ============================================================

CREATE TABLE leituras_sensores (
    id SERIAL PRIMARY KEY,

    sensor_id INTEGER NOT NULL
        REFERENCES sensores(id)
        ON DELETE CASCADE,

    valor NUMERIC(10,2) NOT NULL,

    hora_leitura TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 8. HISTÓRICO DAS IRRIGAÇÕES
-- ============================================================
--
-- Cada registro representa um período em que a irrigação
-- ficou ligada. Enquanto encerrado_em for NULL, a irrigação
-- está em andamento.
--
-- O estado atual fica em dispositivos.irrigacao_ligada.
--
-- ============================================================

CREATE TABLE eventos_irrigacao (
    id SERIAL PRIMARY KEY,

    dispositivo_id INTEGER NOT NULL
        REFERENCES dispositivos(id)
        ON DELETE CASCADE,

    iniciado_em TIMESTAMP NOT NULL,

    encerrado_em TIMESTAMP,

    duracao_minutos INTEGER
        CHECK (
            duracao_minutos IS NULL
            OR duracao_minutos >= 0
        ),

    agua_utilizada_litros NUMERIC(10,2) NOT NULL
        DEFAULT 0
        CHECK (agua_utilizada_litros >= 0),

    umidade_antes NUMERIC(5,2)
        CHECK (
            umidade_antes IS NULL
            OR (
                umidade_antes >= 0
                AND umidade_antes <= 100
            )
        ),

    umidade_depois NUMERIC(5,2)
        CHECK (
            umidade_depois IS NULL
            OR (
                umidade_depois >= 0
                AND umidade_depois <= 100
            )
        ),

    CHECK (
        encerrado_em IS NULL
        OR encerrado_em >= iniciado_em
    )
);


-- ============================================================
-- 9. RECUPERAÇÃO DE SENHA
-- ============================================================
--
-- Fluxo: o usuário pede o link -> o Flask cria um token aleatório,
-- guarda SOMENTE o hash dele aqui e envia o token por e-mail.
-- Ao abrir o link, o Flask confere: o hash existe, não expirou
-- (expira_em) e ainda não foi usado (usado_em IS NULL).
-- Ao salvar a nova senha, usado_em é preenchido (uso único).
--
-- ============================================================

CREATE TABLE tokens_recuperacao_senha (
    id SERIAL PRIMARY KEY,

    usuario_id INTEGER NOT NULL
        REFERENCES usuarios(id)
        ON DELETE CASCADE,

    token_hash TEXT NOT NULL UNIQUE,

    expira_em TIMESTAMP NOT NULL,

    usado_em TIMESTAMP,

    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 10. TROCA DE E-MAIL COM CONFIRMAÇÃO
-- ============================================================
--
-- O e-mail em usuarios SÓ muda depois que o usuário clica no
-- link enviado para o NOVO endereço (confirmado_em preenchido).
--
-- ============================================================

CREATE TABLE solicitacoes_troca_email (
    id SERIAL PRIMARY KEY,

    usuario_id INTEGER NOT NULL
        REFERENCES usuarios(id)
        ON DELETE CASCADE,

    novo_email VARCHAR(150) NOT NULL,

    token_hash TEXT NOT NULL UNIQUE,

    expira_em TIMESTAMP NOT NULL,

    confirmado_em TIMESTAMP,

    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 11. ÍNDICES
-- ============================================================

CREATE INDEX idx_dispositivos_propriedade
ON dispositivos(propriedade_id);

CREATE INDEX idx_sensores_dispositivo
ON sensores(dispositivo_id);

CREATE INDEX idx_leituras_sensor_hora
ON leituras_sensores(sensor_id, hora_leitura);

CREATE INDEX idx_eventos_dispositivo_data
ON eventos_irrigacao(dispositivo_id, iniciado_em);

-- Um dispositivo não pode ter duas irrigações abertas ao mesmo tempo
CREATE UNIQUE INDEX ux_evento_aberto_por_dispositivo
ON eventos_irrigacao(dispositivo_id)
WHERE encerrado_em IS NULL;

CREATE INDEX idx_tokens_recuperacao_usuario
ON tokens_recuperacao_senha(usuario_id);

CREATE INDEX idx_troca_email_usuario
ON solicitacoes_troca_email(usuario_id);

-- (O índice de propriedades por usuário já existe pela
--  restrição UNIQUE em propriedades.usuario_id.)


-- ============================================================
-- 12. CONSUMO DIÁRIO
-- ============================================================
--
-- O consumo diário é calculado a partir dos eventos
-- de irrigação (não é duplicado em outra tabela).
--
-- Alimenta: cartões e gráfico da tela "Consumo de água"
-- (hoje, 7 dias, 30 dias, total, período personalizado,
-- maior, menor e média).
--
-- Só existem linhas para os dias que tiveram irrigação.
--
-- ============================================================

CREATE VIEW consumo_diario AS

SELECT
    d.propriedade_id,

    DATE(e.iniciado_em) AS data_consumo,

    ROUND(
        SUM(e.agua_utilizada_litros),
        2
    ) AS agua_utilizada_litros

FROM eventos_irrigacao e

JOIN dispositivos d
    ON d.id = e.dispositivo_id

GROUP BY
    d.propriedade_id,
    DATE(e.iniciado_em);


-- ============================================================
-- 13. VIEW RESUMIDA DO DASHBOARD
-- ============================================================
--
-- Uma linha por usuário/propriedade/dispositivo.
-- LEFT JOIN: um usuário recém-cadastrado (sem propriedade ou
-- sem ESP32) também aparece, com os campos vazios (NULL).
--
-- ============================================================

CREATE VIEW resumo_dashboard AS

SELECT

    u.id AS usuario_id,
    u.nome AS nome_usuario,

    p.id AS propriedade_id,
    p.nome AS nome_propriedade,
    p.localizacao,
    p.area_hectares,
    p.cultura,
    p.metodo_irrigacao,
    p.limite_umidade,
    p.limite_umidade_desliga,

    d.id AS dispositivo_id,
    d.codigo_dispositivo,
    d.online,
    d.irrigacao_ligada,
    d.ultimo_sinal,

    (
        SELECT sr.valor
        FROM leituras_sensores sr

        JOIN sensores s
            ON s.id = sr.sensor_id

        WHERE s.dispositivo_id = d.id
          AND s.tipo = 'umidade_solo'

        ORDER BY sr.hora_leitura DESC

        LIMIT 1
    ) AS umidade_atual,

    (
        SELECT sr.valor
        FROM leituras_sensores sr

        JOIN sensores s
            ON s.id = sr.sensor_id

        WHERE s.dispositivo_id = d.id
          AND s.tipo = 'temperatura'

        ORDER BY sr.hora_leitura DESC

        LIMIT 1
    ) AS temperatura_atual,

    (
        SELECT sr.valor
        FROM leituras_sensores sr

        JOIN sensores s
            ON s.id = sr.sensor_id

        WHERE s.dispositivo_id = d.id
          AND s.tipo = 'vazao_agua'

        ORDER BY sr.hora_leitura DESC

        LIMIT 1
    ) AS vazao_atual,

    COALESCE(
        (
            SELECT SUM(e.agua_utilizada_litros)

            FROM eventos_irrigacao e

            WHERE e.dispositivo_id = d.id

              AND DATE(e.iniciado_em) = CURRENT_DATE
        ),
        0
    ) AS consumo_agua_hoje

FROM usuarios u

LEFT JOIN propriedades p
    ON p.usuario_id = u.id

LEFT JOIN dispositivos d
    ON d.propriedade_id = p.id;
