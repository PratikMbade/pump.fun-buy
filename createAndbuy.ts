import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { TokenData } from './buyPump';

export async function sendCreateBundleAPI(
  imageFile: Express.Multer.File,
  tokenMetadata: TokenData,
  tokenCreator: Keypair,
  buyAmount: number,
  devWalletsKeypairs: Keypair[]
) {
  console.log(
    'printing all the data:',
    imageFile,
    tokenMetadata,
    tokenCreator,
    buyAmount,
    devWalletsKeypairs
  );

  const mintKeypair = Keypair.generate(); // generates a random keypair for token
  console.log('mintKeypair:', mintKeypair.publicKey.toString());
  console.log('buyAmount:', buyAmount);

  const formData = new FormData();

  // Helper: convert file buffer to Blob
  const bufferToBlob = (buffer: Buffer, type: string): Blob => {
    return new Blob([buffer], { type });
  };

  // Convert image buffer to Blob and upload
  const imageBlob = bufferToBlob(imageFile.buffer, 'image/png'); // adjust MIME type
  formData.append('file', imageBlob, imageFile.originalname);
  formData.append('name', tokenMetadata.tokenName);
  formData.append('symbol', tokenMetadata.tokenSymbol);
  formData.append('description', tokenMetadata.tokenDescription);
  formData.append('twitter', tokenMetadata.twitterLink || '');
  formData.append('telegram', tokenMetadata.telegramLink || '');
  formData.append('website', tokenMetadata.websiteLink || '');
  formData.append('showName', 'true');

  // 1) Upload metadata to IPFS
  let metadataResponse = await fetch('https://pump.fun/api/ipfs', {
    method: 'POST',
    body: formData,
  });
  let metadataResponseJSON = await metadataResponse.json();

  // 2) Build the "create" transaction arg
  const createTxArg = {
    publicKey: tokenCreator.publicKey.toBase58(),
    action: 'create',
    tokenMetadata: {
      name: tokenMetadata.tokenName,
      symbol: tokenMetadata.tokenSymbol,
      uri: metadataResponseJSON.metadataUri,
    },
    mint: mintKeypair.publicKey.toBase58(),
    denominatedInSol: 'false',
    amount: buyAmount,
    slippage: 10,
    priorityFee: 0.0001, // jito tip for first tx
    pool: 'pump',
  };

  // 3) Build "buy" transaction args for each dev wallet
  const buyTxArgs = devWalletsKeypairs.slice(0, 4).map((devWalletKeypair) => ({
    publicKey: devWalletKeypair.publicKey.toBase58(),
    action: 'buy',
    mint: mintKeypair.publicKey.toBase58(),
    denominatedInSol: 'false',
    amount: buyAmount,
    slippage: 10,
    priorityFee: 0.00005, // after first tx, typically ignored
    pool: 'pump',
  }));

  // Combine into one big list of instructions
  const bundledTxArgs = [createTxArg, ...buyTxArgs];

  // Chunk them (5 instructions per chunk, for example)
  const chunkSize = 2;

  // We'll store final signed+encoded transactions and signatures
  let encodedSignedTransactions: string[] = [];
  let signatures: string[] = [];

  const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bundledTxArgs),
  });

  if (response.status === 200) {
    // successfully generated transactions
    const transactions = await response.json();
    console.log('transactions:', transactions);
    let encodedSignedTransactions = [];
    let signatures = [];
    let tx;
    for (let i = 0; i < bundledTxArgs.length; i++) {
      tx = VersionedTransaction.deserialize(
        new Uint8Array(bs58.decode(transactions[i]))
      );
      if (bundledTxArgs[i].action === 'create') {
        // creation transaction needs to be signed by mint and creator keypairs
        tx.sign([mintKeypair, tokenCreator]);
      } else {
        tx.sign([devWalletsKeypairs[i - 1]]);
      }
      encodedSignedTransactions.push(bs58.encode(tx.serialize()));
      signatures.push(bs58.encode(tx.signatures[0]));
    }

    const ser = tx?.serialize();

    console.log('ser', ser?.length);
  }

  const buyTxArgs2 = devWalletsKeypairs.slice(4).map((devWalletKeypair) => ({
    publicKey: devWalletKeypair.publicKey.toBase58(),
    action: 'buy',
    mint: mintKeypair.publicKey.toBase58(),
    denominatedInSol: 'false',
    amount: buyAmount,
    slippage: 10,
    priorityFee: 0.00005, // after first tx, typically ignored
    pool: 'pump',
  }));

  const res = await fetch(`https://pumpportal.fun/api/trade-local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buyTxArgs2),
  });

  console.log('res:', res);
  const devWalletsKeypairs2 = devWalletsKeypairs.slice(4);

  if (res.status === 200) {
    // successfully generated transactions
    const transactions = await res.json();
    console.log('transactions 2:', transactions);
    let encodedSignedTransactions = [];
    let signatures = [];
    let tx;
    for (let i = 0; i < buyTxArgs2.length; i++) {
      tx = VersionedTransaction.deserialize(
        new Uint8Array(bs58.decode(transactions[i]))
      );
      console.log(
        'devWalletsKeypairs2:',
        devWalletsKeypairs2[i].publicKey.toString()
      );
      tx.sign([devWalletsKeypairs2[i]]);

      encodedSignedTransactions.push(bs58.encode(tx.serialize()));
      signatures.push(bs58.encode(tx.signatures[0]));
    }

    const ser = tx?.serialize();

    console.log('ser', ser?.length);
  }

  // You can return or handle encodedSignedTransactions as needed
}
