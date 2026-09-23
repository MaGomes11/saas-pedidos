'use strict';

import { api } from '../api.js';
import { esc, toast, spinner } from '../ui.js';

export const title = 'Festa';

export async function render(container, params) {
  container.innerHTML = spinner();
  const editing = !!params.id;
  let party = null;
  let dishTypes = [];
  try {
    [dishTypes] = await Promise.all([api.get('/dish-types?all=1')]);
    if (editing) party = await api.get(`/parties/${params.id}`);
  } catch (e) {
    container.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>${editing ? `Editar festa: ${esc(party.name)}` : 'Nova festa'}</h1>
      <a class="btn btn-ghost" href="#/parties">← Voltar</a>
    </div>
    <div class="card">
      <form id="party-form" novalidate>
        <div class="form-grid">
          <div class="field">
            <label>Nome da festa/evento <span class="req">*</span></label>
            <input class="input" name="name" required value="${esc(party?.name || '')}" placeholder="Ex.: Casamento Ana & Pedro" />
          </div>
          <div class="field">
            <label>Cliente / responsável</label>
            <input class="input" name="client_name" value="${esc(party?.client_name || '')}" placeholder="Nome do cliente" />
          </div>
          <div class="field">
            <label>Data <span class="req">*</span></label>
            <input class="input" type="date" name="date" required value="${esc(party?.date || '')}" />
          </div>
          <div class="field">
            <label>Local</label>
            <input class="input" name="location" value="${esc(party?.location || '')}" placeholder="Salão / endereço" />
          </div>
          <div class="field">
            <label>Horário de início</label>
            <input class="input" type="time" name="start_time" value="${esc(party?.start_time || '')}" />
          </div>
          <div class="field">
            <label>Horário de término</label>
            <input class="input" type="time" name="end_time" value="${esc(party?.end_time || '')}" />
          </div>
          <div class="field">
            <label>Quantidade estimada de mesas</label>
            <input class="input" type="number" min="0" name="table_count" value="${party?.table_count || 0}" />
          </div>
          <div class="field">
            <label>Tipo de cardápio</label>
            <select class="select" name="dish_type_id">
              <option value="">— Sem cardápio —</option>
              ${dishTypes.map((t) => `<option value="${t.id}" ${party?.dish_type_id === t.id ? 'selected' : ''}>${esc(t.name)}${t.active ? '' : ' (inativo)'}</option>`).join('')}
            </select>
            <div class="hint">Somente cardápios ativos aparecem para vínculo. Inativos permanecem no histórico.</div>
          </div>
          <div class="field">
            <label>Status</label>
            <select class="select" name="status">
              ${['planejada', 'ativa', 'encerrada', 'cancelada'].map((s) =>
                `<option value="${s}" ${(party?.status || 'planejada') === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Observações gerais</label>
          <textarea class="textarea" name="notes" placeholder="Alergias, exigências do cliente, detalhes do evento...">${esc(party?.notes || '')}</textarea>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-lg" type="submit">${editing ? '💾 Salvar alterações' : '＋ Criar festa'}</button>
          ${editing ? '<a class="btn btn-lg btn-ghost" href="#/parties/' + party.id + '">Cancelar</a>' : ''}
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector('#party-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = val(form);
    data.table_count = Number(data.table_count) || 0;
    data.dish_type_id = data.dish_type_id ? Number(data.dish_type_id) : null;
    try {
      if (editing) {
        await api.put(`/parties/${party.id}`, data);
        toast('Festa atualizada com sucesso.');
        location.hash = `#/parties/${party.id}`;
      } else {
        const created = await api.post('/parties', data);
        toast('Festa criada com sucesso.');
        location.hash = `#/parties/${created.id}`;
      }
    } catch (ex) {
      toast(ex.message, 'error');
    }
  });
}

function val(form) {
  const obj = {};
  form.querySelectorAll('[name]').forEach((f) => {
    if (f.type === 'number') obj[f.name] = f.value === '' ? 0 : Number(f.value);
    else obj[f.name] = f.value;
  });
  return obj;
}