// Não há sessão administrativa nem envio de credenciais na hospedagem estática.
export const localAuthClient = {
  auth: {
    async getSession() { return { data: { session: null }, error: null }; },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signInWithPassword() {
      return {
        data: { session: null },
        error: new Error("La gestione dei contenuti è disponibile nella versione locale del sito."),
      };
    },
    async signOut() { return { error: null }; },
  },
};
