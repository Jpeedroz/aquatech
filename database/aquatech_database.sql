-- AQUATECH - estrutura do banco (PostgreSQL 11 ou superior)

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

CREATE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

CREATE UNIQUE INDEX ux_usuarios_email
ON usuarios (LOWER(email));

CREATE TRIGGER trg_usuarios_atualizado
BEFORE UPDATE ON usuarios
FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();

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

CREATE TABLE leituras_sensores (
    id SERIAL PRIMARY KEY,

    sensor_id INTEGER NOT NULL
        REFERENCES sensores(id)
        ON DELETE CASCADE,

    valor NUMERIC(10,2) NOT NULL,

    hora_leitura TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX idx_dispositivos_propriedade
ON dispositivos(propriedade_id);

CREATE INDEX idx_sensores_dispositivo
ON sensores(dispositivo_id);

CREATE INDEX idx_leituras_sensor_hora
ON leituras_sensores(sensor_id, hora_leitura);

CREATE INDEX idx_eventos_dispositivo_data
ON eventos_irrigacao(dispositivo_id, iniciado_em);

CREATE UNIQUE INDEX ux_evento_aberto_por_dispositivo
ON eventos_irrigacao(dispositivo_id)
WHERE encerrado_em IS NULL;

CREATE INDEX idx_tokens_recuperacao_usuario
ON tokens_recuperacao_senha(usuario_id);

CREATE INDEX idx_troca_email_usuario
ON solicitacoes_troca_email(usuario_id);

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
