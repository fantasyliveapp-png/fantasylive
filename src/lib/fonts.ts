import localFont from 'next/font/local';
import { Inter } from 'next/font/google';

/** Wordmark de marca — exclusivo para el texto "Fantazy Live" / "FANTAZY LIVE". */
export const fontBrand = localFont({
  src: '../../public/fonts/Akira-Expanded-Demo.otf',
  weight: '800',
  variable: '--font-brand',
  display: 'swap',
});

/** Titulares y subtitulos de seccion. */
export const fontHeading = localFont({
  src: '../../public/fonts/BebasNeue-Regular.ttf',
  weight: '400',
  variable: '--font-heading',
  display: 'swap',
});

/** Texto de interfaz: parrafos, formularios, botones, chat, navegacion. */
export const fontBody = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const fontVariables = `${fontBrand.variable} ${fontHeading.variable} ${fontBody.variable}`;
