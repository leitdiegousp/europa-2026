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
    } else if (b.category === "temple" || b.category === "activity" || b.startTime || b.time) {
      startIso = b.startTime || b.time;
      endIso = b.endTime || b.end || null;
      tz = b.tz || tz;
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

  // 1. Identificar eventos EM ANDAMENTO
  const activeEvents = normalized.filter(item => item.startDate <= now && item.endDate && now <= item.endDate);

  // Se houver evento ativo que NÃO seja apenas estadia (ex: templo, voo, passeio), ele tem prioridade absoluta
  const specificActive = activeEvents.filter(item => item.raw.category !== "stay");
  if (specificActive.length > 0) {
    // Escolhe o que iniciou mais recentemente
    specificActive.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
    const currentItem = specificActive[0];
    return {
      status: "EM ANDAMENTO",
      badgeColor: "emerald",
      event: currentItem.raw,
      startFormatted: formatTimeInZone(currentItem.startIso, currentItem.tz),
      endFormatted: formatTimeInZone(currentItem.endIso, currentItem.tz),
      tzLabel: getTimezoneLabel(currentItem.startIso, currentItem.tz),
      countdown: null,
      notes: "Você está vivendo esta etapa agora."
    };
  }

  // 2. Se a única atividade em andamento for uma estadia de hotel (que dura dias),
  // verificar se há uma PRÓXIMA ETAPA iminente nas próximas 36 horas para orientar o viajante
  const upcomingEvents = normalized.filter(item => item.startDate > now);
  if (upcomingEvents.length > 0) {
    const nextItem = upcomingEvents[0];
    const diffHours = (nextItem.startDate.getTime() - now.getTime()) / (1000 * 3600);

    // Se houver evento iminente (dentro de 36 horas) ou se não houver nenhuma estadia em andamento, exibe como Próxima Etapa
    if (activeEvents.length === 0 || diffHours <= 36) {
      const cd = getCountdown(nextItem.startIso, now);
      return {
        status: "PRÓXIMA ETAPA",
        badgeColor: "amber",
        event: nextItem.raw,
        startFormatted: formatTimeInZone(nextItem.startIso, nextItem.tz),
        endFormatted: nextItem.endIso ? formatTimeInZone(nextItem.endIso, nextItem.tz) : null,
        tzLabel: getTimezoneLabel(nextItem.startIso, nextItem.tz),
        countdown: cd.text,
        notes: `Faltam ${cd.text} para o início desta etapa.`
      };
    }
  }

  // 3. Caso haja estadia em andamento sem eventos nas próximas 36h
  if (activeEvents.length > 0) {
    const currentItem = activeEvents[0];
    return {
      status: "EM ANDAMENTO",
      badgeColor: "emerald",
      event: currentItem.raw,
      startFormatted: formatTimeInZone(currentItem.startIso, currentItem.tz),
      endFormatted: formatTimeInZone(currentItem.endIso, currentItem.tz),
      tzLabel: getTimezoneLabel(currentItem.startIso, currentItem.tz),
      countdown: null,
      notes: "Hospedagem ativa neste momento."
    };
  }

  // 4. Caso todos já tenham passado
  return {
    status: "VIAGEM CONCLUÍDA",
    badgeColor: "slate",
    event: null,
    notes: "Todas as etapas programadas foram concluídas com sucesso!"
  };
}
