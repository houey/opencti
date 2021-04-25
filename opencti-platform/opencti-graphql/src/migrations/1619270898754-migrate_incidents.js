import * as R from 'ramda';
import { Promise } from 'bluebird';
import { READ_INDEX_STIX_DOMAIN_OBJECTS } from '../database/utils';
import { BULK_TIMEOUT, elBulk, elList, ES_MAX_CONCURRENCY, MAX_SPLIT } from '../database/elasticSearch';
import { generateStandardId } from '../schema/identifier';
import { logApp } from '../config/conf';
import { SYSTEM_USER } from '../domain/user';
import { ENTITY_TYPE_INCIDENT } from '../schema/stixDomainObject';

export const up = async (next) => {
  const start = new Date().getTime();
  logApp.info(`[MIGRATION] Rewriting IDs and types of Incidents`);
  const bulkOperations = [];
  const callback = (entities) => {
    const op = entities
      .map((entity) => {
        const newStandardId = generateStandardId(ENTITY_TYPE_INCIDENT, entity);
        return [
          { update: { _index: entity._index, _id: entity.id } },
          {
            doc: {
              // Fix bad fields
              entity_type: ENTITY_TYPE_INCIDENT,
              standard_id: newStandardId,
            },
          },
        ];
      })
      .flat();
    bulkOperations.push(...op);
  };
  // Old type
  const opts = { types: ['X-OpenCTI-Incident'], callback };
  await elList(SYSTEM_USER, READ_INDEX_STIX_DOMAIN_OBJECTS, opts);
  // Apply operations.
  let currentProcessing = 0;
  const groupsOfOperations = R.splitEvery(MAX_SPLIT, bulkOperations);
  const concurrentUpdate = async (bulk) => {
    await elBulk({ refresh: true, timeout: BULK_TIMEOUT, body: bulk });
    currentProcessing += bulk.length;
    logApp.info(`[OPENCTI] Rewriting IDs and types: ${currentProcessing} / ${bulkOperations.length}`);
  };
  await Promise.map(groupsOfOperations, concurrentUpdate, { concurrency: ES_MAX_CONCURRENCY });
  logApp.info(`[MIGRATION] Rewriting IDs and types done in ${new Date() - start} ms`);
  next();
};

export const down = async (next) => {
  next();
};