import { redirect } from 'next/navigation';

/**
 * La entrada a la web es el Descubrir: cualquiera puede mirar (tras
 * confirmar que es mayor de edad, en AgeGate). Para hacer algo se le pide
 * crear su cuenta de fan (aviso "Unete gratis").
 */
export default function HomePage() {
  redirect('/feed');
}
