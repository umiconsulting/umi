# The forgotten-password journey

Generated: 2026-10-11T08:29:59.028Z · http://127.0.0.1:4000 · account prueba-reset@umiconsulting.co

The address typed into the visible form: `nadie@ejemplo.invalid`

| Step                     | Result | Detail                                                                                           |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------ |
| sign-in screen           | ok     | the link to the request view is on the sign-in screen                                            |
| request view             | ok     | heading "¿Olvidaste tu contraseña?", the email field is present                                  |
| request sent             | ok     | the confirmation view answers and names the 15-minute expiry                                     |
| message and link         | ok     | the message arrived · subject "Reestablecer contraseña · Umi Dashboard" · link on 127.0.0.1:4000 |
| new-password view        | ok     | heading "Nueva contraseña", two hidden fields, the language control is present                   |
| reveal toggle            | ok     | the password can be shown and hidden, and the control says which it will do                      |
| language on the form     | ok     | "Nueva contraseña" → "New password" → "Nueva contraseña"                                         |
| refuses a short password | ok     | the form refuses it in its own words, before the API is asked                                    |
| refuses a mismatch       | ok     | the form refuses two different passwords                                                         |
| sets the password        | ok     | the API accepted the token and the view confirms the change                                      |
| signs in with it         | ok     | the browser left the sign-in screen for /                                                        |

## The message

- to `prueba-reset@umiconsulting.co`, subject `Reestablecer contraseña · Umi Dashboard`
- greeting: `Hola Prueba Reset,`
- the link points at `127.0.0.1:4000`
