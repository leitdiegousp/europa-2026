/**
 * Europa 2026 - Time & Timezone Engine
 * =====================================
 * Resiliente a fusos horários IANA e à transição do fim do horário
 * de verão europeu em 25/10/2026 (CEST UTC+2 -> CET UTC+1).
 */

export const IANA_ZONES = Object.freeze({
  FLN: "America/Sao_Paulo",
  LIS: "Europe/Lisbon",
  MAD: "Europe/Madrid",
  GVA: "Europe/Zurich",
  SAILLON: "Europe/Zurich",
  TOLEDO: "Europe/Madrid"
});

/**
 * Formata um horário ISO no fuso local do evento
 */
export function formatTimeInZone(isoString, timeZone = "Europe/Madrid") {
  if (!isoString) return "--:--";
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

/**
 * Formata uma data completa com dia da semana
 */
export function formatDateInZone(isoString, timeZone = "Europe/Madrid") {
  if (!isoString) return "";
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

/**
 * Retorna a sigla e o offset do fuso horário (ex: "CEST (UTC+2)" ou "CET (UTC+1)")
 */
export function getTimezoneLabel(isoString, timeZone = "Europe/Madrid") {
  if (!isoString) return timeZone;
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    timeZoneName: "short"
  }).formatToParts(date);
  const tzPart = parts.find(p => p.type === "timeZoneName");
  return tzPart ? tzPart.value : timeZone;
}

/**
 * Calcula a contagem regressiva legível para humanos
 */
export function getCountdown(targetIso, now = new Date()) {
  const target = new Date(targetIso);
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { past: true, text: "Iniciado / Concluído", diffMs };
  }

  const diffSec = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);

  let text = "";
  if (days > 0) {
    text += `${days}d `;
  }
  if (hours > 0 || days > 0) {
    text += `${hours}h `;
  }
  text += `${minutes}min`;

  return { past: false, text, diffMs, days, hours, minutes };
}

/**
 * Avalia a lista de reservas e determina o card "O que fazer agora / Próxima Etapa"
 */
export function computeCurrentStep(bookings = [], simulatedNow = null) {
  const now = simulatedNow ? new Date(simulatedNow) : new Date();

  // Ordenar eventos por timestamp de início
  const normalized = bookings.map(b => {
    let startIso = null;
    let endIso = null;
    let tz = b.tz || "Europe/Madrid";

    if (b.category === "flight") {
      startIso = b.departure.time;
      endIso = b.arrival.time;
      tz = b.departure.tz || tz;
    } else if (b.category === "stay") {
      startIso = b.checkIn;
      endIso = b.checkOut;
    } else if (b.category === "car") {
      startIso = b.pickup.time;
      endIso = b.dropoff.time;
      tz = b.pickup.tz || tz;
    }

    const startDate = startIso ? new Date(startIso) : null;
    const endDate = endIso ? new Date(endIso) : null;

    return {
      raw: b,
      startIso,
      endIso,
      startDate,
      endDate,
      tz
    };
  }).filter(e => e.startDate !== null);

  normalized.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // 1. Verificar se há algum evento EM ANDAMENTO
  for (const item of normalized) {
    if (item.startDate <= now && item.endDate && now <= item.endDate) {
      return {
        status: "EM ANDAMENTO",
        badgeColor: "emerald",
        event: item.raw,
        startFormatted: formatTimeInZone(item.startIso, item.tz),
        endFormatted: formatTimeInZone(item.endIso, item.tz),
        tzLabel: getTimezoneLabel(item.startIso, item.tz),
        countdown: null,
        notes: "Você está vivendo esta etapa agora."
      };
    }
  }

  // 2. Procurar o PRÓXIMO evento a ocorrer
  for (const item of normalized) {
    if (item.startDate > now) {
      const cd = getCountdown(item.startIso, now);
      return {
        status: "PRÓXIMA ETAPA",
        badgeColor: "amber",
        event: item.raw,
        startFormatted: formatTimeInZone(item.startIso, item.tz),
        endFormatted: item.endIso ? formatTimeInZone(item.endIso, item.tz) : null,
        tzLabel: getTimezoneLabel(item.startIso, item.tz),
        countdown: cd.text,
        notes: `Faltam ${cd.text} para o início desta etapa.`
      };
    }
  }

  // 3. Caso todos já tenham passado
  return {
    status: "VIAGEM CONCLUÍDA",
    badgeColor: "slate",
    event: null,
    notes: "Todas as etapas programadas foram concluídas com sucesso!"
  };
}
