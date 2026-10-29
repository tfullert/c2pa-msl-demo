#ifndef C2PA_MSL_H
#define C2PA_MSL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct C2paSignedResult {
  uint8_t *signed_data;
  size_t signed_data_len;
  char *manifest_id;
  char *manifest_json;
  char *error_message;
  int32_t error_code;
  char *output_path;
} C2paSignedResult;

typedef struct C2paPrepareResult {
  char *hash_to_sign_b64;
  char *preparation_token;
  int32_t error_code;
  char *error_message;
} C2paPrepareResult;

/*
 * Signs an in-memory asset. Required strings: filename, roles_csv, account_id.
 * Optional strings may be NULL: tsa_url, user_id, additional_actions_json,
 * signing_metadata_json, trace_id.
 */
C2paSignedResult *c2pa_sign_content(
  const uint8_t *file_data,
  size_t file_data_len,
  const char *filename,
  const char *roles_csv,
  const char *tsa_url,
  const char *account_id,
  const char *user_id,
  const char *additional_actions_json,
  const char *signing_metadata_json,
  const char *trace_id
);

/*
 * Signs an asset from input_path and writes it to output_path. Required strings:
 * input_path, output_path, filename, roles_csv, account_id. Optional strings
 * may be NULL: tsa_url, user_id, additional_actions_json,
 * signing_metadata_json, trace_id.
 */
C2paSignedResult *c2pa_sign_content_from_path(
  const char *input_path,
  const char *output_path,
  const char *filename,
  const char *roles_csv,
  const char *tsa_url,
  const char *account_id,
  const char *user_id,
  const char *additional_actions_json,
  const char *signing_metadata_json,
  const char *trace_id
);

/*
 * Signs content with CAWG identity assertion (one-shot convenience).
 * Generates CAWG metadata automatically from roles.
 * CAWG roles: creator, contributor, editor, producer, publisher, sponsor, translator.
 * Optional strings may be NULL: tsa_url, user_id, additional_actions_json,
 * signing_metadata_json, trace_id.
 */
C2paSignedResult *c2pa_sign_content_with_cawg_identity(
  const uint8_t *file_data,
  size_t file_data_len,
  const char *filename,
  const char *roles_csv,
  const char *tsa_url,
  const char *account_id,
  const char *user_id,
  const char *additional_actions_json,
  const char *signing_metadata_json,
  const char *trace_id
);

/*
 * Path-based CAWG identity signing. Reads from input_path, writes to output_path.
 * Optional strings may be NULL: tsa_url, user_id, additional_actions_json,
 * signing_metadata_json, trace_id.
 */
C2paSignedResult *c2pa_sign_content_with_cawg_identity_from_path(
  const char *input_path,
  const char *output_path,
  const char *filename,
  const char *roles_csv,
  const char *tsa_url,
  const char *account_id,
  const char *user_id,
  const char *additional_actions_json,
  const char *signing_metadata_json,
  const char *trace_id
);

/*
 * Two-step CAWG signing (prepare phase). Returns hash to sign.
 * Pass the result's hash_to_sign_b64 to an external signer, then call
 * c2pa_complete_cawg_signing with the preparation_token and raw signature.
 * Required strings: filename, cawg_certificate_chain_pem, hard_binding_hash_b64,
 * roles_csv, account_id. Optional strings may be NULL: tsa_url, user_id,
 * additional_actions_json, signing_metadata_json, trace_id.
 */
C2paPrepareResult *c2pa_prepare_cawg_signing(
  const uint8_t *file_data,
  size_t file_data_len,
  const char *filename,
  const char *cawg_certificate_chain_pem,
  const char *hard_binding_hash_b64,
  const char *roles_csv,
  const char *tsa_url,
  const char *account_id,
  const char *user_id,
  const char *additional_actions_json,
  const char *signing_metadata_json,
  const char *trace_id
);

/*
 * Path-based two-step CAWG signing (prepare phase). Required strings:
 * input_path, output_path, filename, cawg_certificate_chain_pem,
 * hard_binding_hash_b64, roles_csv, account_id. Optional strings may be NULL:
 * tsa_url, user_id, additional_actions_json, signing_metadata_json, trace_id.
 */
C2paPrepareResult *c2pa_prepare_cawg_signing_from_path(
  const char *input_path,
  const char *output_path,
  const char *filename,
  const char *cawg_certificate_chain_pem,
  const char *hard_binding_hash_b64,
  const char *roles_csv,
  const char *tsa_url,
  const char *account_id,
  const char *user_id,
  const char *additional_actions_json,
  const char *signing_metadata_json,
  const char *trace_id
);

/*
 * Completes two-step CAWG signing with preparation_token and raw signature.
 */
C2paSignedResult *c2pa_complete_cawg_signing(
  const uint8_t *file_data,
  size_t file_data_len,
  const char *filename,
  const char *preparation_token,
  const char *cawg_raw_signature_b64
);

C2paSignedResult *c2pa_complete_cawg_signing_from_path(
  const char *input_path,
  const char *output_path,
  const char *filename,
  const char *preparation_token,
  const char *cawg_raw_signature_b64
);

void c2pa_free_result(C2paSignedResult *result);
void c2pa_free_prepare_result(C2paPrepareResult *result);
void c2pa_free_string(char *s);

#ifdef __cplusplus
}
#endif

#endif /* C2PA_MSL_H */
