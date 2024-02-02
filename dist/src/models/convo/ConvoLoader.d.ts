import { RunnableConfig } from "@langchain/core/runnables";
import type { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import RWSVectorStore, { VectorDocType } from '../convo/VectorStore';
import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import { BaseChain } from "langchain/chains";
import RWSPrompt, { IRWSPromptJSON } from "../prompts/_prompt";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { ChainValues } from "@langchain/core/utils/types";
interface IConvoDebugXMLData {
    conversation: {
        $: {
            id: string;
            [key: string]: string;
        };
        message: IRWSPromptJSON[];
    };
}
interface IChainCallOutput {
    text: string;
}
interface IEmbeddingsHandler<T extends object = {}> {
    generateEmbeddings: (text?: string) => Promise<T>;
    storeEmbeddings: (embeddings: any, convoId: string) => Promise<void>;
}
declare class ConvoLoader<LLMClient extends BaseLanguageModelInterface, LLMChat extends SimpleChatModel> {
    private loader;
    private docSplitter;
    private embeddings;
    private docs;
    private _initiated;
    private store;
    private convo_id;
    private llmClient;
    private llmChain;
    private llmChat;
    private chatConstructor;
    private thePrompt;
    constructor(chatConstructor: new (config: any) => LLMChat, embeddings: IEmbeddingsHandler, convoId?: string | null);
    static uuid(): string;
    init(pathToTextFile: string, chunkSize?: number, chunkOverlap?: number, separators?: string[]): Promise<ConvoLoader<LLMClient, LLMChat>>;
    getId(): string;
    getDocs(): VectorDocType;
    getStore(): RWSVectorStore;
    isInitiated(): boolean;
    setLLMClient(client: LLMClient): ConvoLoader<LLMClient, LLMChat>;
    getLLMClient(): LLMClient;
    setPrompt(prompt: RWSPrompt): ConvoLoader<LLMClient, LLMChat>;
    getChat(): LLMChat;
    private avgDocLength;
    call(values: ChainValues, cfg: RunnableConfig, debugCallback?: (debugData: IConvoDebugXMLData) => Promise<IConvoDebugXMLData>): Promise<RWSPrompt>;
    callStreamGenerator(this: ConvoLoader<LLMClient, LLMChat>, values: ChainValues, cfg: RunnableConfig, debugCallback?: (debugData: IConvoDebugXMLData) => Promise<IConvoDebugXMLData>): AsyncGenerator<IterableReadableStream<ChainValues>>;
    callStream(values: ChainValues, callback: (streamChunk: string) => void, cfg?: RunnableConfig, debugCallback?: (debugData: IConvoDebugXMLData) => Promise<IConvoDebugXMLData>): Promise<RWSPrompt>;
    callChat(content: string, embeddingsEnabled?: boolean, debugCallback?: (debugData: IConvoDebugXMLData) => Promise<IConvoDebugXMLData>): Promise<RWSPrompt>;
    private debugCall;
    chain(hyperParamsMap?: {
        [key: string]: string;
    }): Promise<BaseChain>;
    private createChain;
    waitForInit(): Promise<ConvoLoader<LLMClient, LLMChat> | null>;
    private parseXML;
    static debugConvoDir(): string;
    debugConvoFile(): string;
    private initDebugFile;
    private debugSave;
}
export default ConvoLoader;
export { IChainCallOutput, IConvoDebugXMLData, IEmbeddingsHandler };
