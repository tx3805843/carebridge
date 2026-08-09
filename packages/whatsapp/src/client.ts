/** Thin wrapper over the WhatsApp Business Cloud API (Meta direct, not a BSP). */

export interface WhatsappClientConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

export interface SendTemplateMessageInput {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: Record<string, unknown>[];
}

export class WhatsappClient {
  constructor(private readonly config: WhatsappClientConfig) {}

  private get baseUrl() {
    const version = this.config.apiVersion ?? "v20.0";
    return `https://graph.facebook.com/${version}/${this.config.phoneNumberId}/messages`;
  }

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<{ messageId: string }> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode ?? "en" },
          components: input.components ?? [],
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { messages: { id: string }[] };
    return { messageId: body.messages[0].id };
  }
}
