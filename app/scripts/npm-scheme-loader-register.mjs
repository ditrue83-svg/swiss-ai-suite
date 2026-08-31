// Node non conosce lo schema `npm:` di Deno. Questa registrazione permette
// alle sole suite offline di importare lo stesso modulo condiviso che gira
// nelle Edge Function, senza mantenere una seconda implementazione del PDF.
import { register } from 'node:module';

register('./npm-scheme-loader.mjs', import.meta.url);
