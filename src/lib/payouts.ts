import { createHash } from 'node:crypto';
import { z } from 'zod';

import { COUNTRY_CODES } from '@/lib/countries';
import type { PayoutDestination } from '@/lib/payout-methods';

// Reexporta las constantes compartidas para no obligar a importar de dos
// sitios en el servidor. El cliente debe importar de "@/lib/payout-methods".
export {
  PAYOUT_METHODS,
  PAYOUT_METHOD_LABELS,
  PAYOUT_METHOD_HINTS,
  type ActivePayoutMethod,
  type PayoutDestination,
} from '@/lib/payout-methods';

// ---------------------------------------------------------------------------
// VALIDADORES
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(input: string): Buffer | null {
  let num = 0n;
  for (const char of input) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) return null;
    num = num * 58n + BigInt(index);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }

  // Cada '1' inicial en base58 representa un byte 0x00
  for (const char of input) {
    if (char !== '1') break;
    bytes.unshift(0);
  }

  return Buffer.from(bytes);
}

/**
 * Valida una direccion TRON (TRC20) completa: prefijo, longitud, alfabeto
 * base58 y checksum doble-SHA256. Sin el checksum un solo caracter mal escrito
 * mandaria el USDT a una direccion inexistente.
 */
export function isValidTronAddress(address: string): boolean {
  const value = address.trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;

  const decoded = base58Decode(value);
  // 21 bytes de payload (0x41 + 20 de direccion) + 4 de checksum
  if (!decoded || decoded.length !== 25) return false;
  if (decoded[0] !== 0x41) return false;

  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const expected = createHash('sha256')
    .update(createHash('sha256').update(payload).digest())
    .digest()
    .subarray(0, 4);

  return checksum.equals(expected);
}

/** Valida un IBAN por longitud y resto mod-97 (ISO 13616). */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (!COUNTRY_CODES.has(iban.slice(0, 2))) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) =>
    String(ch.charCodeAt(0) - 55),
  );

  // mod 97 por bloques para no desbordar Number
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** True si la cadena tiene forma de IBAN (para decidir si validar mod-97). */
function looksLikeIban(value: string): boolean {
  const cleaned = value.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(cleaned);
}

const swiftBic = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/\s/g, ''))
  .refine((v) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), {
    message: 'El codigo SWIFT/BIC debe tener 8 u 11 caracteres.',
  });

const accountNumber = z
  .string()
  .trim()
  .min(6, 'Numero de cuenta demasiado corto.')
  .max(40, 'Numero de cuenta demasiado largo.')
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .refine((v) => /^[A-Z0-9]+$/.test(v), {
    message: 'El numero de cuenta solo admite letras y numeros.',
  })
  .refine((v) => !looksLikeIban(v) || isValidIban(v), {
    message: 'El IBAN no es valido (falla el digito de control).',
  });

// ---------------------------------------------------------------------------
// ESQUEMAS POR METODO
// ---------------------------------------------------------------------------

export const wireTransferSchema = z.object({
  method: z.literal('WIRE_TRANSFER'),
  accountHolder: z
    .string()
    .trim()
    .min(3, 'Indica el titular de la cuenta.')
    .max(120),
  bankName: z.string().trim().min(2, 'Indica el nombre del banco.').max(120),
  accountNumber,
  swiftBic,
  bankCountry: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => COUNTRY_CODES.has(v), 'Pais del banco no valido.'),
  bankAddress: z.string().trim().max(200).optional().or(z.literal('')),
});

export const usdtTrc20Schema = z.object({
  method: z.literal('USDT_TRC20'),
  address: z
    .string()
    .trim()
    .refine(isValidTronAddress, {
      message:
        'Direccion TRC20 no valida. Debe empezar por T y tener 34 caracteres.',
    }),
});

export const paypalSchema = z.object({
  method: z.literal('PAYPAL'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Introduce un correo de PayPal valido.')
    .max(160),
});

export const payoutDestinationSchema = z.discriminatedUnion('method', [
  wireTransferSchema,
  usdtTrc20Schema,
  paypalSchema,
]);

// ---------------------------------------------------------------------------
// SERIALIZACION Y PRESENTACION
// ---------------------------------------------------------------------------

/** Valor corto e identificable del destino, usado para generar la mascara. */
export function destinationIdentifier(destination: PayoutDestination): string {
  switch (destination.method) {
    case 'WIRE_TRANSFER':
      return destination.accountNumber;
    case 'USDT_TRC20':
      return destination.address;
    case 'PAYPAL':
      return destination.email;
  }
}

/**
 * Resumen legible para el panel de admin, ya descifrado.
 * Devuelve lineas "Etiqueta: valor" en el orden en que conviene leerlas.
 */
export function describeDestination(
  destination: PayoutDestination,
): Array<{ label: string; value: string }> {
  switch (destination.method) {
    case 'WIRE_TRANSFER':
      return [
        { label: 'Titular', value: destination.accountHolder },
        { label: 'Banco', value: destination.bankName },
        { label: 'Cuenta / IBAN', value: destination.accountNumber },
        { label: 'SWIFT / BIC', value: destination.swiftBic },
        { label: 'Pais del banco', value: destination.bankCountry },
        ...(destination.bankAddress
          ? [{ label: 'Direccion del banco', value: destination.bankAddress }]
          : []),
      ];
    case 'USDT_TRC20':
      return [
        { label: 'Red', value: 'TRON (TRC20)' },
        { label: 'Direccion', value: destination.address },
      ];
    case 'PAYPAL':
      return [{ label: 'Correo PayPal', value: destination.email }];
  }
}

/** Parsea el JSON descifrado de vuelta a un destino tipado, o null. */
export function parseDestination(raw: string): PayoutDestination | null {
  try {
    const parsed = payoutDestinationSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
