import TheService from "./_service";
import IAppConfig from "../interfaces/IAppConfig";

const AppDefaultConfig: IAppConfig = {
  mongo_url: null,
  mongo_db: null,
  port: null,        
  test_port: null,
  domain: null,
  ssl_cert: null,
  ssl_key: null,
  secret_key: null,
  user_class: null,
  user_models: [],
  controller_list: [],
  ws_routes: {},
  http_routes: [],
  commands: [],
  aws_lambda_region: null,
  aws_access_key: null,
  aws_secret_key: null,
  aws_lambda_role: null,
  aws_lambda_bucket: null
};

class AppConfigService extends TheService{
  private data: IAppConfig; // Add type assertion here  
  private cfgString: string;

  constructor(cfg: IAppConfig) {
    super();    
    this.data = cfg;
  }    

  public get(key: keyof IAppConfig): any
  {     
    return this.data[key as keyof IAppConfig];
  }

  public reloadConfig(cfgString: string): AppConfigService 
  {
    const cfg: () => IAppConfig = (require(cfgString)).defaults; 
    this.data = cfg();

    return this;
  }

  public static getConfigSingleton<T extends new (...args: any[]) => TheService>(this: T, cfg?: IAppConfig): AppConfigService
  {
    const className = this.name;
    const instanceExists = TheService._instances[className];
    
    if (cfg) {                
        TheService._instances[className] = new this(cfg);        
    }else if(!instanceExists && !cfg){
        TheService._instances[className] = new this(AppDefaultConfig);           
    }

    return TheService._instances[className] as AppConfigService;
  }
}

export default (cfg?: IAppConfig): AppConfigService => AppConfigService.getConfigSingleton(cfg);
export { IAppConfig, AppDefaultConfig }