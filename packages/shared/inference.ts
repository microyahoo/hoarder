import { Ollama } from "ollama";
import OpenAI from "openai";
import axios from "axios";

import serverConfig from "./config";
import logger from "./logger";

export interface InferenceResponse {
  response: string;
  totalTokens: number | undefined;
}

export interface InferenceOptions {
  json: boolean;
}

const defaultInferenceOptions: InferenceOptions = {
  json: true,
};

export interface InferenceClient {
  inferFromText(
    prompt: string,
    opts: InferenceOptions,
  ): Promise<InferenceResponse>;
  inferFromImage(
    prompt: string,
    contentType: string,
    image: string,
    opts: InferenceOptions,
  ): Promise<InferenceResponse>;
  // TODO: inferFromVideo();
}

export class InferenceClientFactory {
  static build(): InferenceClient | null {
    if (serverConfig.inference.openAIApiKey) {
      return new OpenAIInferenceClient();
    }

    if (serverConfig.inference.ollamaBaseUrl) {
      return new OllamaInferenceClient();
    }
    // TODO: support more AI clients
    if (serverConfig.inference.zhipuApiKey) {
      return new ZhipuInferenceClient();
    }
    return null;
  }
}

class OpenAIInferenceClient implements InferenceClient {
  openAI: OpenAI;

  constructor() {
    this.openAI = new OpenAI({
      apiKey: serverConfig.inference.openAIApiKey,
      baseURL: serverConfig.inference.openAIBaseUrl,
    });
  }

  async inferFromText(
    prompt: string,
    opts: InferenceOptions = defaultInferenceOptions,
  ): Promise<InferenceResponse> {
    const chatCompletion = await this.openAI.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: serverConfig.inference.textModel,
      response_format: opts.json ? { type: "json_object" } : undefined,
    });

    const response = chatCompletion.choices[0].message.content;
    if (!response) {
      throw new Error(`Got no message content from OpenAI`);
    }
    return { response, totalTokens: chatCompletion.usage?.total_tokens };
  }

  async inferFromImage(
    prompt: string,
    contentType: string,
    image: string,
    opts: InferenceOptions = defaultInferenceOptions,
  ): Promise<InferenceResponse> {
    const chatCompletion = await this.openAI.chat.completions.create({
      model: serverConfig.inference.imageModel,
      response_format: opts.json ? { type: "json_object" } : undefined,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${contentType};base64,${image}`,
                detail: "low",
              },
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    const response = chatCompletion.choices[0].message.content;
    if (!response) {
      throw new Error(`Got no message content from OpenAI`);
    }
    return { response, totalTokens: chatCompletion.usage?.total_tokens };
  }
}

class OllamaInferenceClient implements InferenceClient {
  ollama: Ollama;

  constructor() {
    this.ollama = new Ollama({
      host: serverConfig.inference.ollamaBaseUrl,
    });
  }

  async runModel(
    model: string,
    prompt: string,
    image?: string,
    opts: InferenceOptions = defaultInferenceOptions,
  ) {
    const chatCompletion = await this.ollama.chat({
      model: model,
      format: opts.json ? "json" : undefined,
      stream: true,
      keep_alive: serverConfig.inference.ollamaKeepAlive,
      options: {
        num_ctx: serverConfig.inference.contextLength,
      },
      messages: [
        { role: "user", content: prompt, images: image ? [image] : undefined },
      ],
    });

    let totalTokens = 0;
    let response = "";
    try {
      for await (const part of chatCompletion) {
        response += part.message.content;
        if (!isNaN(part.eval_count)) {
          totalTokens += part.eval_count;
        }
        if (!isNaN(part.prompt_eval_count)) {
          totalTokens += part.prompt_eval_count;
        }
      }
    } catch (e) {
      // There seem to be some bug in ollama where you can get some successful response, but still throw an error.
      // Using stream + accumulating the response so far is a workaround.
      // https://github.com/ollama/ollama-js/issues/72
      totalTokens = NaN;
      logger.warn(
        `Got an exception from ollama, will still attempt to deserialize the response we got so far: ${e}`,
      );
    }

    return { response, totalTokens };
  }

  async inferFromText(
    prompt: string,
    opts: InferenceOptions = defaultInferenceOptions,
  ): Promise<InferenceResponse> {
    return await this.runModel(
      serverConfig.inference.textModel,
      prompt,
      undefined,
      opts,
    );
  }

  async inferFromImage(
    prompt: string,
    _contentType: string,
    image: string,
    opts: InferenceOptions = defaultInferenceOptions,
  ): Promise<InferenceResponse> {
    return await this.runModel(
      serverConfig.inference.imageModel,
      prompt,
      image,
      opts,
    );
  }
}

class ZhipuInferenceClient implements InferenceClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = serverConfig.inference.zhipuBaseUrl || "https://open.bigmodel.cn/api/paas/v4";
    this.apiKey = serverConfig.inference.zhipuApiKey!;
  }

  private formatPromptForJSON(prompt: string): string {
    return `${prompt}\n请以JSON格式返回结果，确保返回的是有效的JSON字符串。例如：{"key": "value"}`;
  }

  private ensureValidJSON(content: string): string {
    try {
      // 尝试解析为 JSON
      JSON.parse(content);
      return content;
    } catch (e) {
      // 如果不是有效的 JSON，尝试提取 JSON 部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          JSON.parse(jsonMatch[0]);
          return jsonMatch[0];
        } catch (e) {
          // 如果提取的部分仍然不是有效的 JSON
          throw new Error("Unable to extract valid JSON from response");
        }
      }
      throw new Error("Response is not in JSON format");
    }
  }

  async inferFromText(
    prompt: string,
    opts: InferenceOptions = defaultInferenceOptions,
  ): Promise<InferenceResponse> {
    try {
      const finalPrompt = opts.json ? this.formatPromptForJSON(prompt) : prompt;
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: serverConfig.inference.textModel,
          messages: [{ role: "user", content: finalPrompt }],
          stream: false,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        },
        {
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error(`The model ignored our prompt and didn't respond with the expected format`);
      }

      const content = response.data.choices[0].message.content;
      const processedContent = opts.json ? this.ensureValidJSON(content) : content;

      return {
        response: processedContent,
        totalTokens: response.data.usage?.total_tokens,
      };
    } catch (error) {
      logger.error("Error in ZhipuInferenceClient.inferFromText:", error);
      throw error;
    }
  }

  async inferFromImage(
    prompt: string,
    contentType: string,
    image: string,
    opts: InferenceOptions = defaultInferenceOptions,
  ): Promise<InferenceResponse> {
    try {
      const finalPrompt = opts.json ? this.formatPromptForJSON(prompt) : prompt;
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: serverConfig.inference.imageModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: finalPrompt },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          stream: false,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        },
        {
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.data?.choices?.[0]?.message?.content) {
        throw new Error(`The model ignored our prompt and didn't respond with the expected format`);
      }

      const content = response.data.choices[0].message.content;
      const processedContent = opts.json ? this.ensureValidJSON(content) : content;

      return {
        response: processedContent,
        totalTokens: response.data.usage?.total_tokens,
      };
    } catch (error) {
      logger.error("Error in ZhipuInferenceClient.inferFromImage:", error);
      throw error;
    }
  }
}
