import type { FromSchema } from 'json-schema-to-ts';
import * as schemas from './schemas';
export type CriarPGinaCheckoutApiBodyParam = FromSchema<typeof schemas.CriarPGinaCheckoutApi.body>;
export type CriarPGinaCheckoutApiMetadataParam = FromSchema<typeof schemas.CriarPGinaCheckoutApi.metadata>;
export type CriarPGinaCheckoutApiResponse200 = FromSchema<typeof schemas.CriarPGinaCheckoutApi.response['200']>;
export type CriarPGinaCheckoutApiResponse400 = FromSchema<typeof schemas.CriarPGinaCheckoutApi.response['400']>;
