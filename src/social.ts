export async function postMisskeyNote(message: string, misskeyToken: string) {
  await fetch('https://misskey.io/api/notes/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: message,
      i: misskeyToken,
    }),
  });
}
